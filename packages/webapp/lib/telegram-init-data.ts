'use client';

let initData: string | null = null;

export function setTelegramInitData(data: string) {
  initData = data;
}

export function getTelegramInitData(): string | null {
  return initData;
}
