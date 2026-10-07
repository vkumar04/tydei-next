export function floorToHour(date: Date): Date {
  const floored = new Date(date)
  floored.setUTCMinutes(0, 0, 0)
  return floored
}
