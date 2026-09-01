import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** "3일 후", "2시간 후", "지금" — students never see a raw timestamp. */
export function relativeKo(target: Date, now: Date = new Date()): string {
  const diff = target.getTime() - now.getTime()
  if (diff <= 0) return '지금'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes}분 후`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}시간 후`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}일 후`
  return `${Math.round(days / 30)}개월 후`
}

export function greetingKo(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 5) return '늦은 밤이에요'
  if (hour < 12) return '좋은 아침이에요'
  if (hour < 18) return '좋은 오후예요'
  return '좋은 저녁이에요'
}
