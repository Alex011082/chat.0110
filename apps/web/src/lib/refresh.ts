/**
 * Долгая загрузка должна показать свой ответ до следующего опроса.
 * События во время неё склеиваются в одно обновление следом: опубликованное
 * в середине запроса сообщение не теряется, параллельные запросы не копятся.
 */
export class RefreshQueue {
  private pending = new Map<string, { again: boolean; promise: Promise<void> }>();

  run(key: string, load: () => Promise<void>): Promise<void> {
    const old = this.pending.get(key);
    if (old) { old.again = true; return old.promise; }
    const entry = { again: false, promise: Promise.resolve() };
    this.pending.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      do {
        entry.again = false;
        await load();
      } while (entry.again);
    }).finally(() => { this.pending.delete(key); });
    return entry.promise;
  }
}
