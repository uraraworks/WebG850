/**
 * キー入力の行き先分岐（依頼「3. キー入力の行き先を分離する」）。
 *
 * `keydown`/`keyup` は `window` に付けたまま（`ui/main.ts`）だが、フォーム部品
 * （プログラム入力欄の `<textarea>` や RUN/BREAK/LIST ボタン）にフォーカスが
 * あるあいだは、イベントの `target` がそのフォーム部品自身になる。ここを
 * 見て「フォーム部品が打鍵を受け取っているときはエミュレータへ渡さない」を
 * 判定する。
 *
 * 【判断した点・理由】 `document.activeElement` を毎回参照する実装も考えたが、
 * イベント自身の `target` は「このキー入力が実際にどこへ打たれたか」を
 * 直接表しており、余計な状態参照が要らない分こちらのほうが単純で
 * テストもしやすい（DOM 全体を組み立てず `{ tagName }` だけのオブジェクトで
 * 検証できる）。
 */

/** エミュレータへキーを渡さない（＝そのフォーム部品が打鍵を受け取る）対象タグ名。 */
const FORM_TAG_NAMES = new Set(['TEXTAREA', 'INPUT', 'BUTTON', 'SELECT']);

/**
 * `KeyboardEvent.target` が「フォーム部品（＝キーを奪ってよい相手）」かどうかを判定する。
 * `target` が無い・`tagName` を持たない場合は false（＝エミュレータへ渡す）。
 */
export function isFormControlTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const tagName = (target as { tagName?: unknown }).tagName;
  return typeof tagName === 'string' && FORM_TAG_NAMES.has(tagName.toUpperCase());
}
