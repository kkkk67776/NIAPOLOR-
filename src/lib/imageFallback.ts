import type React from 'react';

export const FALLBACK_STORE_IMAGE = '/assets/images/niapolor-badge.webp';

export function handleStoreImageError(event: React.SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (!img) return;

  const currentSrc = img.getAttribute('src') || '';
  if (currentSrc === FALLBACK_STORE_IMAGE || img.dataset.failedSrc === currentSrc) {
    return;
  }

  img.dataset.failedSrc = currentSrc;
  img.dataset.echoxFallback = '1';
  if (img.classList.contains('object-cover')) {
    img.dataset.wasObjectCover = '1';
    img.classList.remove('object-cover');
    img.classList.add('object-contain', 'p-2');
  }
  img.src = FALLBACK_STORE_IMAGE;
}

export function handleStoreImageLoad(event: React.SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (!img) return;
  const currentSrc = img.getAttribute('src') || '';
  if (currentSrc !== FALLBACK_STORE_IMAGE) {
    delete img.dataset.failedSrc;
    delete img.dataset.echoxFallback;
    if (img.dataset.wasObjectCover === '1') {
      delete img.dataset.wasObjectCover;
      img.classList.remove('object-contain', 'p-2');
      img.classList.add('object-cover');
    }
  }
}
