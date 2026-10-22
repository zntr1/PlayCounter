export function localDateTimeValue(date: Date) {
  // Format a Date as the value expected by <input type="datetime-local">
  // (local time, no timezone suffix): YYYY-MM-DDTHH:mm.
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
