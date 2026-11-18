import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Download,
  Upload,
  RotateCcw,
  Lock,
  Archive,
  FileSearch,
  Trash2,
  Eye,
  Database,
  History,
  X,
} from 'lucide-react';
import {
  fetchSystemIntegrityAudit,
  fetchSecurityAuditLogs,
  fetchSecurityQuarantine,
  actOnQuarantineItem,
  listServerBackupSnapshots,
  createServerSignedBackup,
  dryRunServerRecovery,
  applyServerRecovery,
  rollbackServerRecovery,
  emergencyLockdownCall,
  notifySessionExpired,
  SystemIntegrityReport,
  SecurityAuditLogEntry,
  QuarantineVaultItem,
  RecoverySnapshotSummary,
  RecoveryDryRunResult,
} from '../../lib/security';
import { runSafeBackupAndDownload } from '../../lib/safeBackup';

interface SecretControlRoomProps {
  onCatalogRestored?: () => Promise<void> | void;
}

type ControlSection = 'integrity' | 'recovery' | 'quarantine' | 'audit';

type PendingPinAction =
  | { type: 'create_backup'; label: string }
  | { type: 'apply_restore'; snapshotId?: string; bundle?: unknown; allowUnsigned: boolean }
  | { type: 'rollback'; snapshotId?: string };

function formatDateTimeAr(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-TN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const SecretControlRoom: React.FC<SecretControlRoomProps> = ({ onCatalogRestored }) => {
  const [section, setSection] = useState<ControlSection>('integrity');
  const [loading, setLoading] = useState(true);
  const [bannerError, setBannerError] = useState('');
  const [bannerSuccess, setBannerSuccess] = useState('');

  // Integrity state
  const [integrityReport, setIntegrityReport] = useState<SystemIntegrityReport | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<Record<string, unknown> | null>(null);

  // Recovery & Snapshots state
  const [snapshots, setSnapshots] = useState<RecoverySnapshotSummary[]>([]);
  const [backupLabel, setBackupLabel] = useState('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [uploadedBundle, setUploadedBundle] = useState<unknown>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<RecoveryDryRunResult | null>(null);
  const [dryRunTargetLabel, setDryRunTargetLabel] = useState<string>('');
  const [allowUnsignedConfirm, setAllowUnsignedConfirm] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [localBackupRunning, setLocalBackupRunning] = useState(false);

  // Quarantine Vault state
  const [quarantineItems, setQuarantineItems] = useState<QuarantineVaultItem[]>([]);
  const [activeQuarantineCount, setActiveQuarantineCount] = useState(0);
  const [inspectedItem, setInspectedItem] = useState<QuarantineVaultItem | null>(null);

  // Audit Log state
  const [auditEntries, setAuditEntries] = useState<SecurityAuditLogEntry[]>([]);
  const [auditChainIntact, setAuditChainIntact] = useState(true);
  const [auditTotalEntries, setAuditTotalEntries] = useState(0);
  const [auditBrokenAtSeq, setAuditBrokenAtSeq] = useState<number | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'info' | 'warning' | 'critical'>('all');

  // Step-Up PIN modal state
  const [pendingAction, setPendingAction] = useState<PendingPinAction | null>(null);
  const [stepUpPin, setStepUpPin] = useState('');
  const [stepUpError, setStepUpError] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);

  // Emergency Lockdown confirmation state
  const [confirmLockdownOpen, setConfirmLockdownOpen] = useState(false);
  const [lockdownBusy, setLockdownBusy] = useState(false);

  const loadRoomData = useCallback(async (sev: string = severityFilter) => {
    setLoading(true);
    setBannerError('');
    try {
      const [intRes, snapRes, quarRes, logRes] = await Promise.all([
        fetchSystemIntegrityAudit(),
        listServerBackupSnapshots(),
        fetchSecurityQuarantine(),
        fetchSecurityAuditLogs(100, sev),
      ]);

      if (intRes.success && intRes.report) {
        setIntegrityReport(intRes.report);
        setPersistenceStatus(intRes.persistenceStatus || null);
      } else if (intRes.error) {
        setBannerError(intRes.error);
      }

      if (snapRes.success) {
        setSnapshots(snapRes.snapshots);
      }

      if (quarRes.success) {
        setQuarantineItems(quarRes.items);
        setActiveQuarantineCount(quarRes.activeCount);
      }

      if (logRes.success) {
        setAuditEntries(logRes.entries);
        setAuditChainIntact(logRes.chainIntact);
        setAuditTotalEntries(logRes.totalEntries);
        setAuditBrokenAtSeq(logRes.brokenAtSeq);
      }
    } catch {
      setBannerError('تعذر تحديث بيانات غرفة التحكم السرية.');
    } finally {
      setLoading(false);
    }
  }, [severityFilter]);

  useEffect(() => {
    loadRoomData();
  }, [loadRoomData]);

  const handleSeverityChange = async (nextSev: 'all' | 'info' | 'warning' | 'critical') => {
    setSeverityFilter(nextSev);
    const res = await fetchSecurityAuditLogs(100, nextSev);
    if (res.success) {
      setAuditEntries(res.entries);
      setAuditChainIntact(res.chainIntact);
      setAuditTotalEntries(res.totalEntries);
      setAuditBrokenAtSeq(res.brokenAtSeq);
    }
  };

  const handleLocalSafeBackupDownload = async () => {
    setLocalBackupRunning(true);
    setBannerError('');
    setBannerSuccess('');
    try {
      const result = await runSafeBackupAndDownload({ mode: 'storefront-readonly' });
      setBannerSuccess(`تم إنشاء وتنزيل نسخة ECHOX SAFE BACKUP v5.3 المنقاة بنجاح (${result.fileName}).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر إنشاء النسخة المحلية المنقاة.';
      setBannerError(msg);
    } finally {
      setLocalBackupRunning(false);
    }
  };

  const handleFileUploadForDryRun = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerError('');
    setBannerSuccess('');
    setAllowUnsignedConfirm(false);
    setSelectedSnapshotId('');
    setUploadedFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setUploadedBundle(parsed);
      setBusyAction(true);
      const res = await dryRunServerRecovery({ bundle: parsed });
      setBusyAction(false);
      if (!res.success || !res.dryRun) {
        setBannerError(res.error || 'فشل تحليل ملف النسخة الاحتياطية.');
        setDryRunResult(null);
        return;
      }
      setDryRunResult(res.dryRun);
      setDryRunTargetLabel(`ملف محلي: ${file.name}`);
    } catch {
      setBusyAction(false);
      setUploadedBundle(null);
      setDryRunResult(null);
      setBannerError('الملف المرفوع ليس بصيغة JSON صالحة.');
    }
  };

  const handleDryRunSnapshot = async (snapshotId: string, label: string) => {
    setBannerError('');
    setBannerSuccess('');
    setUploadedBundle(null);
    setUploadedFileName('');
    setAllowUnsignedConfirm(false);
    setSelectedSnapshotId(snapshotId);
    setBusyAction(true);
    const res = await dryRunServerRecovery({ snapshotId });
    setBusyAction(false);
    if (!res.success || !res.dryRun) {
      setBannerError(res.error || 'تعذر فحص اللقطة الاحتياطية.');
      return;
    }
    setDryRunResult(res.dryRun);
    setDryRunTargetLabel(`لقطة خادم: ${label}`);
  };

  const handleQuarantineAction = async (id: string, action: 'inspect' | 'purge') => {
    setBannerError('');
    setBannerSuccess('');
    const res = await actOnQuarantineItem(id, action);
    if (!res.success) {
      setBannerError(res.error || 'تعذر تنفيذ الإجراء على العنصر المحجور.');
      return;
    }
    if (action === 'inspect' && res.item) {
      setInspectedItem(res.item);
      const logRes = await fetchSecurityAuditLogs(100, severityFilter);
      if (logRes.success) {
        setAuditEntries(logRes.entries);
        setAuditChainIntact(logRes.chainIntact);
        setAuditTotalEntries(logRes.totalEntries);
        setAuditBrokenAtSeq(logRes.brokenAtSeq);
      }
    } else if (action === 'purge') {
      if (inspectedItem?.id === id) setInspectedItem(null);
      setBannerSuccess('تم التخلص النهائي من العينة المحجورة وتسجيل العملية في سجل التدقيق.');
      await loadRoomData();
    }
  };

  const handleEmergencyLockdown = async () => {
    setLockdownBusy(true);
    setBannerError('');
    setBannerSuccess('');
    try {
      const ok = await emergencyLockdownCall();
      setConfirmLockdownOpen(false);
      if (ok) {
        notifySessionExpired();
      } else {
        setBannerError('تعذر تنفيذ القفل الأمني الفوري عبر الخادم.');
      }
    } catch {
      setBannerError('حدث خطأ أثناء تنفيذ الإغلاق الأمني الفوري.');
    } finally {
      setLockdownBusy(false);
    }
  };

  const handleExportAuditReport = () => {
    const reportPayload = {
      exportedAt: new Date().toISOString(),
      chainIntact: auditChainIntact,
      totalEntries: auditTotalEntries,
      brokenAtSeq: auditBrokenAtSeq ?? null,
      integritySummary: integrityReport
        ? {
            overallStatus: integrityReport.overallStatus,
            checkedAt: integrityReport.checkedAt,
            checks: integrityReport.checks,
          }
        : null,
      entries: auditEntries,
    };
    const blob = new Blob([JSON.stringify(reportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echox-security-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBannerSuccess('تم تصدير تقرير التدقيق وسلسلة التشفير SHA-256 بنجاح.');
  };

  const openStepUpModal = (action: PendingPinAction) => {
    setPendingAction(action);
    setStepUpPin('');
    setStepUpError('');
  };

  const executeStepUpAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction) return;
    if (stepUpPin.trim().length < 6) {
      setStepUpError('يرجى إدخال رمز الـ PIN المكون من 6 أرقام للتأكيد.');
      return;
    }
    setStepUpBusy(true);
    setStepUpError('');
    setBannerError('');
    setBannerSuccess('');

    try {
      if (pendingAction.type === 'create_backup') {
        const res = await createServerSignedBackup(stepUpPin.trim(), pendingAction.label || undefined);
        if (!res.success) {
          setStepUpError(res.error || 'فشل تأكيد الـ PIN أو إنشاء اللقطة.');
          setStepUpBusy(false);
          return;
        }
        setBackupLabel('');
        if (res.snapshots) setSnapshots(res.snapshots);
        setPendingAction(null);
        setBannerSuccess(`تم إنشاء لقطة احتياطية موقعة HMAC (${res.snapshot?.snapshotId || ''}) بنجاح.`);
        await loadRoomData();
      } else if (pendingAction.type === 'apply_restore') {
        const res = await applyServerRecovery({
          confirmPin: stepUpPin.trim(),
          snapshotId: pendingAction.snapshotId,
          bundle: pendingAction.bundle,
          allowUnsigned: pendingAction.allowUnsigned,
        });
        if (!res.success) {
          setStepUpError(res.error || 'فشل تطبيق الاستعادة الآمنة.');
          setStepUpBusy(false);
          return;
        }
        if (res.snapshots) setSnapshots(res.snapshots);
        setPendingAction(null);
        setDryRunResult(null);
        setUploadedBundle(null);
        setUploadedFileName('');
        setSelectedSnapshotId('');
        setBannerSuccess(
          `${res.message || 'تمت الاستعادة بنجاح.'} (نقطة التراجع التلقائية: ${res.preRestoreSnapshotId || '—'})`
        );
        if (onCatalogRestored) await onCatalogRestored();
        await loadRoomData();
      } else if (pendingAction.type === 'rollback') {
        const res = await rollbackServerRecovery(stepUpPin.trim(), pendingAction.snapshotId);
        if (!res.success) {
          setStepUpError(res.error || 'فشل تنفيذ التراجع الفوري.');
          setStepUpBusy(false);
          return;
        }
        setPendingAction(null);
        setBannerSuccess(res.message || 'تم التراجع الفوري إلى نقطة ما قبل الاستعادة بنجاح.');
        if (onCatalogRestored) await onCatalogRestored();
        await loadRoomData();
      }
    } finally {
      setStepUpBusy(false);
    }
  };

  const latestPreRestore = snapshots.find((s) => s.kind === 'pre_restore');

  const dryRunRows = dryRunResult
    ? [
        { key: 'products', label: 'المنتجات', data: dryRunResult.diff.products },
        { key: 'companies', label: 'الشركات الشريكة', data: dryRunResult.diff.companies },
        { key: 'categories', label: 'التصنيفات', data: dryRunResult.diff.categories },
        { key: 'banners', label: 'البانرات الإعلانية', data: dryRunResult.diff.banners },
        { key: 'orders', label: 'الطلبات', data: dryRunResult.diff.orders },
      ]
    : [];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Unified Header */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-[#FF6B00] shrink-0" />
              <h2 className="text-lg font-black text-[#0F172A] dark:text-white tracking-tight">
                غرفة التحكم السرية والحماية والاستعادة
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              فحص السلامة البنيوية · النسخ الاحتياطي الموقّع HMAC · المعاينة قبل الاستعادة (Dry-Run) · الحجر الأمني · سلسلة التدقيق SHA-256
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => loadRoomData()}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-[#0F172A] dark:text-white flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث الفحص الأمني</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmLockdownOpen((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>إغلاق أمني فوري</span>
            </button>
          </div>
        </div>

        {confirmLockdownOpen && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <span className="font-bold text-red-800 dark:text-red-200">
              تأكيد الإغلاق الطارئ: سيتم إبطال جميع الجلسات النشطة وتوقيعات الكوكيز على كل الأجهزة فوراً.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmLockdownOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-700 text-red-700 dark:text-red-200 font-bold cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={lockdownBusy}
                onClick={handleEmergencyLockdown}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer disabled:opacity-60"
              >
                {lockdownBusy ? 'جاري الإبطال...' : 'تنفيذ الإغلاق الآن'}
              </button>
            </div>
          </div>
        )}

        {/* High-Signal Architectural Telemetry Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-[#E2E8F0] dark:border-slate-800 text-xs">
          <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">حالة النظام العامة</span>
            <div className="flex items-center gap-1.5 font-black">
              {integrityReport?.overallStatus === 'healthy' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-400">سليم ومستقر</span>
                </>
              ) : integrityReport?.overallStatus === 'critical' ? (
                <>
                  <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-red-600 dark:text-red-400">تنبيه حرج</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-400">
                    {integrityReport ? 'يتطلب مراجعة' : 'جاري الفحص'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">سلسلة التدقيق SHA-256</span>
            <div className="flex items-center gap-1.5 font-black tabular-nums">
              {auditChainIntact ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  مترابطة ({auditTotalEntries} سجل)
                </span>
              ) : (
                <span className="text-red-600 dark:text-red-400">
                  انكسار عند #{auditBrokenAtSeq ?? 0}
                </span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">عناصر الحجر النشطة</span>
            <span className={`font-black tabular-nums block ${activeQuarantineCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[#0F172A] dark:text-white'}`}>
              {activeQuarantineCount} ملف محجور
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-800 space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">اللقطات الاحتياطية الموقعة</span>
            <span className="font-black tabular-nums text-[#0F172A] dark:text-white block">
              {snapshots.length} لقطة
            </span>
          </div>
        </div>

        {/* Clean Section Switcher */}
        <div className="flex flex-wrap gap-2 pt-2">
          {(
            [
              { id: 'integrity', label: 'فحص السلامة الشامل', icon: ShieldCheck },
              { id: 'recovery', label: 'النسخ الاحتياطي والاستعادة', icon: Database },
              { id: 'quarantine', label: `خزينة الحجر (${activeQuarantineCount})`, icon: Archive },
              { id: 'audit', label: `سجل التدقيق (${auditTotalEntries})`, icon: History },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors border ${
                  active
                    ? 'bg-[#0F172A] dark:bg-[#FF6B00] text-white border-[#0F172A] dark:border-[#FF6B00]'
                    : 'bg-[#F8FAFC] dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 border-[#E2E8F0] dark:border-slate-700 hover:border-slate-400'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback Banners */}
      {bannerError && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{bannerError}</span>
        </div>
      )}
      {bannerSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{bannerSuccess}</span>
        </div>
      )}

      {/* SECTION 1: SYSTEM INTEGRITY AUDIT */}
      {section === 'integrity' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-[#0F172A] dark:text-white">
                تقرير فحص السلامة البنيوية والأمنية
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                آخر فحص: {formatDateTimeAr(integrityReport?.checkedAt)}
                {persistenceStatus && typeof persistenceStatus.storageMode === 'string'
                  ? ` · وضع التخزين: ${persistenceStatus.storageMode}`
                  : ''}
              </p>
            </div>
          </div>

          {!integrityReport ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-[#E2E8F0] dark:border-slate-700 rounded-xl">
              {loading ? 'جاري تشغيل فحص السلامة...' : 'لا تتوفر بيانات فحص حالياً.'}
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0] dark:divide-slate-800 border border-[#E2E8F0] dark:border-slate-800 rounded-xl overflow-hidden">
              {integrityReport.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="p-4 bg-[#F8FAFC]/60 dark:bg-[#1E293B]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {chk.severity === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : chk.severity === 'critical' ? (
                        <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      )}
                      <span className="text-xs font-black text-[#0F172A] dark:text-white">
                        {chk.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 pr-6">
                      {chk.detail}
                    </p>
                  </div>

                  <span
                    className={`text-[11px] font-bold shrink-0 ${
                      chk.severity === 'ok'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : chk.severity === 'critical'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {chk.severity === 'ok' ? 'سليم (OK)' : chk.severity === 'critical' ? 'حرج (Critical)' : 'تحذير (Warning)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: SIGNED BACKUPS, DRY-RUN DIFF & SAFE RECOVERY */}
      {section === 'recovery' && (
        <div className="space-y-6">
          {/* Backup Creation & Export Bar */}
          <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-black text-[#0F172A] dark:text-white">
              إنشاء نسخة احتياطية أو لقطة استعادة موقعة (Signed Snapshots)
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Server HMAC Signed Snapshot */}
              <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-black text-[#0F172A] dark:text-white">
                    1. لقطة خادم موقّعة HMAC (مع تصفية الأسرار)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    تحفظ المنتجات والشركات والتصنيفات والبانرات والطلبات موقّعة ضد التلاعب على الخادم وتطلب PIN للتأكيد.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={backupLabel}
                    onChange={(e) => setBackupLabel(e.target.value)}
                    placeholder="تسمية اختيارية (مثال: قبل تحديث الأسعار)"
                    className="flex-1 bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-[#0F172A] dark:text-white outline-none focus:border-[#FF6B00]"
                  />
                  <button
                    type="button"
                    onClick={() => openStepUpModal({ type: 'create_backup', label: backupLabel.trim() })}
                    className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white text-xs font-bold cursor-pointer transition-colors shrink-0"
                  >
                    إنشاء لقطة موقّعة (PIN)
                  </button>
                </div>
              </div>

              {/* Safe Backup v5.3 Local Sanitized Export */}
              <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-3 flex flex-col justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-black text-[#0F172A] dark:text-white">
                    2. تنزيل حزمة ECHOX SAFE BACKUP v5.3 المحلية
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    للقراءة فقط ومنقاة تماماً من البيانات الشخصية والأسرار، ومتوافقة مع المعاينة المبدئية للاستعادة.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={localBackupRunning}
                    onClick={handleLocalSafeBackupDownload}
                    className="px-4 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-600 bg-white dark:bg-[#0F172A] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{localBackupRunning ? 'جاري التجهيز...' : 'تنزيل Safe Backup v5.3'}</span>
                  </button>

                  {latestPreRestore && (
                    <button
                      type="button"
                      onClick={() =>
                        openStepUpModal({ type: 'rollback', snapshotId: latestPreRestore.snapshotId })
                      }
                      className="px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>تراجع سريع لآخر نقطة ما قبل الاستعادة</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Dry-Run & Restore Workbench */}
          <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-[#0F172A] dark:text-white">
                  المعاينة المبدئية (Dry-Run Diff) وتطبيق الاستعادة الآمنة
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  يُنشئ النظام تلقائياً لقطة تراجع (Pre-Restore Snapshot) قبل كتابة أي بيانات، مع الحفاظ على مفاتيح بوابات الدفع الحية.
                </p>
              </div>
              <label className="px-3.5 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-[#1E293B] hover:border-[#FF6B00] text-xs font-bold text-[#0F172A] dark:text-white flex items-center gap-1.5 cursor-pointer transition-colors shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>فحص ملف JSON خارجي</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileUploadForDryRun}
                  className="hidden"
                />
              </label>
            </div>

            {busyAction && (
              <div className="p-4 text-xs text-slate-500 text-center">
                جاري حساب الفروقات والتحقق من التوقيع والمخطط...
              </div>
            )}

            {dryRunResult && (
              <div className="border border-[#E2E8F0] dark:border-slate-700 rounded-xl p-4 bg-[#F8FAFC] dark:bg-[#1E293B] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5">
                    <span className="font-black text-[#0F172A] dark:text-white block">
                      نتيجة المعاينة: {dryRunTargetLabel}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      توقيع HMAC: {dryRunResult.signatureValid ? 'سليم ومطابق' : 'غير موقع خادمياً'}
                      {' · '}
                      إعدادات المتجر: {dryRunResult.diff.siteSettingsChanged ? 'ستتغير' : 'مطابقة'}
                      {' · '}
                      الدردشة: {dryRunResult.diff.chatConfigChanged ? 'ستتغير' : 'مطابقة'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDryRunResult(null);
                      setUploadedBundle(null);
                      setUploadedFileName('');
                      setSelectedSnapshotId('');
                    }}
                    className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white p-1 cursor-pointer"
                    aria-label="إغلاق المعاينة"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {dryRunResult.schemaErrors.length > 0 && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 space-y-1">
                    {dryRunResult.schemaErrors.map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                  </div>
                )}

                {dryRunResult.warnings.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    {dryRunResult.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto border border-[#E2E8F0] dark:border-slate-700 rounded-xl bg-white dark:bg-[#0F172A]">
                  <table className="w-full text-xs text-right tabular-nums">
                    <thead className="bg-[#F8FAFC] dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-[#E2E8F0] dark:border-slate-700">
                      <tr>
                        <th className="p-2.5 font-bold">القسم</th>
                        <th className="p-2.5 font-bold">الحالي</th>
                        <th className="p-2.5 font-bold">الوارد</th>
                        <th className="p-2.5 font-bold text-emerald-600 dark:text-emerald-400">إضافة (+)</th>
                        <th className="p-2.5 font-bold text-amber-600 dark:text-amber-400">تعديل (~)</th>
                        <th className="p-2.5 font-bold text-red-600 dark:text-red-400">حذف (-)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800">
                      {dryRunRows.map((row) => (
                        <tr key={row.key}>
                          <td className="p-2.5 font-bold text-[#0F172A] dark:text-white">{row.label}</td>
                          <td className="p-2.5">{row.data.currentCount}</td>
                          <td className="p-2.5">{row.data.incomingCount}</td>
                          <td className="p-2.5 text-emerald-700 dark:text-emerald-400">+{row.data.added}</td>
                          <td className="p-2.5 text-amber-700 dark:text-amber-400">~{row.data.updated}</td>
                          <td className="p-2.5 text-red-600 dark:text-red-400">-{row.data.removed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {dryRunResult.validToApply && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                    {!dryRunResult.signatureValid ? (
                      <label className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowUnsignedConfirm}
                          onChange={(e) => setAllowUnsignedConfirm(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <span>أوافق على استعادة هذه النسخة المحلية غير الموقعة بعد مراجعة الفروقات</span>
                      </label>
                    ) : (
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">
                        التوقيع الخادمي HMAC متحقق منه وجاهز للتطبيق.
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={!dryRunResult.signatureValid && !allowUnsignedConfirm}
                      onClick={() =>
                        openStepUpModal({
                          type: 'apply_restore',
                          snapshotId: selectedSnapshotId || undefined,
                          bundle: uploadedBundle || undefined,
                          allowUnsigned: !dryRunResult.signatureValid && allowUnsignedConfirm,
                        })
                      }
                      className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-colors shrink-0"
                    >
                      تطبيق الاستعادة الآمنة (Step-Up PIN)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Stored Snapshots Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-slate-600 dark:text-slate-300">
                اللقطات المخزنة على الخادم ({snapshots.length})
              </h4>
              {snapshots.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-[#E2E8F0] dark:border-slate-700 rounded-xl">
                  لا توجد لقطات مخزنة بعد. أنشئ أول لقطة موقّعة لحفظ حالة المتجر والطلبات.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#E2E8F0] dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-[#F8FAFC] dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-[#E2E8F0] dark:border-slate-800">
                      <tr>
                        <th className="p-3 font-bold">المعرّف</th>
                        <th className="p-3 font-bold">التسمية والنوع</th>
                        <th className="p-3 font-bold">التاريخ</th>
                        <th className="p-3 font-bold">المحتوى</th>
                        <th className="p-3 font-bold">بصمة SHA-256</th>
                        <th className="p-3 font-bold">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 tabular-nums">
                      {snapshots.map((snap) => (
                        <tr key={snap.snapshotId} className="hover:bg-[#F8FAFC] dark:hover:bg-slate-800/40">
                          <td className="p-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {snap.snapshotId}
                          </td>
                          <td className="p-3 space-y-0.5">
                            <span className="font-bold text-[#0F172A] dark:text-white block">
                              {snap.label}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {snap.kind === 'pre_restore' ? 'تلقائية قبل الاستعادة' : 'يدوية'}
                            </span>
                          </td>
                          <td className="p-3 text-[11px] text-slate-500 dark:text-slate-400">
                            {formatDateTimeAr(snap.createdAt)}
                          </td>
                          <td className="p-3 text-[11px] text-slate-600 dark:text-slate-300">
                            {snap.productsCount} منتج · {snap.companiesCount} شركة · {snap.ordersCount} طلب
                          </td>
                          <td className="p-3 font-mono text-[11px] text-slate-500">
                            {snap.payloadSha256.slice(0, 12)}…
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDryRunSnapshot(snap.snapshotId, snap.label)}
                                className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] dark:border-slate-700 hover:border-[#FF6B00] text-[11px] font-bold text-[#0F172A] dark:text-white flex items-center gap-1 cursor-pointer"
                              >
                                <FileSearch className="w-3 h-3" />
                                <span>معاينة Dry-Run</span>
                              </button>
                              {snap.kind === 'pre_restore' && (
                                <button
                                  type="button"
                                  onClick={() => openStepUpModal({ type: 'rollback', snapshotId: snap.snapshotId })}
                                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>تراجع</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {uploadedFileName && !dryRunResult && !busyAction && (
              <p className="text-[11px] text-slate-500">آخر ملف محدد: {uploadedFileName}</p>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: QUARANTINE VAULT */}
      {section === 'quarantine' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-black text-[#0F172A] dark:text-white">
              خزينة الحجر الأمني للملفات والطلبات المشبوهة
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              يتم عزل أي وصل مزيف التوقيع الثنائي (Magic Bytes) أو يحتوي على شيفرة قابلة للتنفيذ قبل وصوله إلى مخزن المتجر.
            </p>
          </div>

          {inspectedItem && (
            <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-black text-[#0F172A] dark:text-white">
                  معاينة العينة المعزولة (نص آمن معطل التنفيذ): {inspectedItem.id}
                </span>
                <button
                  type="button"
                  onClick={() => setInspectedItem(null)}
                  className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 font-mono break-all">
                Hash: {inspectedItem.payloadHash} · Declared: {inspectedItem.mimeDeclared}
              </p>
              <pre
                dir="ltr"
                className="p-3 rounded-lg bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all"
              >
                {inspectedItem.payloadPreview || 'لا يتوفر مقتطف نصي للعينة.'}
              </pre>
            </div>
          )}

          {quarantineItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#E2E8F0] dark:border-slate-700 rounded-xl">
              خزينة الحجر فارغة — لم يتم تسجيل ملفات مشبوهة حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#E2E8F0] dark:border-slate-800 rounded-xl">
              <table className="w-full text-xs text-right tabular-nums">
                <thead className="bg-[#F8FAFC] dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-[#E2E8F0] dark:border-slate-800">
                  <tr>
                    <th className="p-3 font-bold">التوقيت</th>
                    <th className="p-3 font-bold">المصدر</th>
                    <th className="p-3 font-bold">سبب الحجر</th>
                    <th className="p-3 font-bold">IP / البصمة</th>
                    <th className="p-3 font-bold">الحالة</th>
                    <th className="p-3 font-bold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800">
                  {quarantineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F8FAFC] dark:hover:bg-slate-800/40">
                      <td className="p-3 text-[11px] text-slate-500">{formatDateTimeAr(item.createdAt)}</td>
                      <td className="p-3 font-mono text-[11px]">{item.source}</td>
                      <td className="p-3 text-slate-700 dark:text-slate-200 max-w-xs">{item.reason}</td>
                      <td className="p-3 font-mono text-[11px] text-slate-500">
                        {item.actorIp || '—'} · {item.payloadHash.slice(0, 12)}…
                      </td>
                      <td className="p-3 font-bold">
                        <span className={item.status === 'quarantined' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500'}>
                          {item.status === 'quarantined' ? 'معزول' : 'تم الإتلاف'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleQuarantineAction(item.id, 'inspect')}
                            className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] dark:border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:border-[#FF6B00]"
                          >
                            <Eye className="w-3 h-3" />
                            <span>معاينة</span>
                          </button>
                          {item.status === 'quarantined' && (
                            <button
                              type="button"
                              onClick={() => handleQuarantineAction(item.id, 'purge')}
                              className="px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>حذف</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: HASH-CHAINED AUDIT LOGS */}
      {section === 'audit' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-[#E2E8F0] dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-[#0F172A] dark:text-white">
                سجل التدقيق الأمني المترابط بالتشفير (Hash-Chained Audit Log)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {auditChainIntact
                  ? `السلسلة سليمة بالكامل (${auditTotalEntries} سجل، كل حدث مربوط بـ SHA-256 للحدث السابق).`
                  : `تحذير: تم رصد خلل في تسلسل التشفير عند التسلسل ${auditBrokenAtSeq ?? 0}.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  { id: 'info', label: 'معلومات' },
                  { id: 'warning', label: 'تحذيرات' },
                  { id: 'critical', label: 'حرجة' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleSeverityChange(f.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border ${
                    severityFilter === f.id
                      ? 'bg-[#0F172A] dark:bg-[#FF6B00] text-white border-[#0F172A] dark:border-[#FF6B00]'
                      : 'bg-[#F8FAFC] dark:bg-[#1E293B] text-slate-600 dark:text-slate-300 border-[#E2E8F0] dark:border-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleExportAuditReport}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border border-[#E2E8F0] dark:border-slate-700 bg-white dark:bg-[#0F172A] text-[#0F172A] dark:text-white hover:border-[#FF6B00] flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>تصدير التقرير</span>
              </button>
            </div>
          </div>

          {auditEntries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#E2E8F0] dark:border-slate-700 rounded-xl">
              لا توجد سجلات مطابقة للفلتر المحدد.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#E2E8F0] dark:border-slate-800 rounded-xl">
              <table className="w-full text-xs text-right tabular-nums">
                <thead className="bg-[#F8FAFC] dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-[#E2E8F0] dark:border-slate-800">
                  <tr>
                    <th className="p-3 font-bold">#</th>
                    <th className="p-3 font-bold">التوقيت</th>
                    <th className="p-3 font-bold">الحدث</th>
                    <th className="p-3 font-bold">المستوى</th>
                    <th className="p-3 font-bold">الفاعل / IP</th>
                    <th className="p-3 font-bold">التفاصيل</th>
                    <th className="p-3 font-bold">توقيع السلسلة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800">
                  {auditEntries.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F8FAFC] dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-[11px] text-slate-400">{log.seq}</td>
                      <td className="p-3 text-[11px] text-slate-500 whitespace-nowrap">
                        {formatDateTimeAr(log.timestamp)}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-[#0F172A] dark:text-white">
                        {log.event}
                      </td>
                      <td className="p-3 font-bold text-[11px]">
                        <span
                          className={
                            log.severity === 'critical'
                              ? 'text-red-600 dark:text-red-400'
                              : log.severity === 'warning'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }
                        >
                          {log.severity === 'critical'
                            ? 'حرج'
                            : log.severity === 'warning'
                            ? 'تحذير'
                            : 'معلومات'}
                        </span>
                      </td>
                      <td className="p-3 text-[11px] font-mono text-slate-500">
                        {log.actor} {log.ip ? `· ${log.ip}` : ''}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-200 max-w-md">
                        {log.summary}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-400">
                        {log.entryHash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Step-Up PIN Verification Modal */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={executeStepUpAction}
            className="w-full max-w-md bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-slate-700 rounded-2xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#FF6B00]" />
                <h4 className="text-sm font-black text-[#0F172A] dark:text-white">
                  تأكيد الهوية (Step-Up PIN)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {pendingAction.type === 'create_backup' &&
                'يتطلب إنشاء لقطة احتياطية موقعة HMAC تأكيد رمز الـ PIN الإداري.'}
              {pendingAction.type === 'apply_restore' &&
                'سيتم حفظ نقطة تراجع تلقائية قبل استعادة البيانات المختارة. أدخل رمز الـ PIN للمتابعة.'}
              {pendingAction.type === 'rollback' &&
                'سيتم إرجاع بيانات المتجر والطلبات إلى نقطة التراجع المحددة. أدخل رمز الـ PIN للمتابعة.'}
            </p>

            <div>
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block mb-1.5">
                رمز الـ PIN الإداري (6 أرقام)
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={12}
                value={stepUpPin}
                onChange={(e) => setStepUpPin(e.target.value)}
                placeholder="••••••"
                className="w-full bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-center tracking-widest text-[#0F172A] dark:text-white outline-none focus:border-[#FF6B00]"
              />
            </div>

            {stepUpError && (
              <p className="text-xs font-bold text-red-600 dark:text-red-400">{stepUpError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={stepUpBusy}
                className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {stepUpBusy ? 'جاري التنفيذ...' : 'تأكيد وتنفيذ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
