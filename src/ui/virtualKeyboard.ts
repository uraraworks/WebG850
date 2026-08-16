/**
 * 仮想キーボード（オンスクリーンキーボード）。
 *
 * 同一作者の WebX68k と同じ流儀（`#virtual-keyboard` ＋ `.panel-switch-btn`
 * の開閉ボタン、既存のコピペ用パネルと排他）に揃える。配線は `index.html` /
 * `ui/main.ts` 側で行う。
 *
 * キー配列はユーザー提供の実機写真から起こした（`G850/CLAUDE.md` の依頼参照）。
 * 写真から確実に読み取れなかったキー・挙動が不確定なキーは押しても無反応にせず
 * `?UNSUPPORTED <名前>` をその場に打ち込む形で記録する（`machine.reportUnimplemented`
 * にも積む。親 CLAUDE.md「未実装を無言にしない」方針）。
 *
 * **文字の字形（`machine/font.ts`）には一切触れない。** ここで描くキートップの
 * 文字は HTML/CSS のフォントで表示するだけで、LCD 側の描画とは無関係。
 */

import type { Machine } from '../machine/machine.ts';
import type { DirectMode } from './directMode.ts';
import { dispatchKeydown } from './keyRouting.ts';

/** 仮想キー1つが行う動作。 */
export type VirtualKeyAction =
  /** 1文字を「物理キーを押した」のと同じ経路（`dispatchKeydown`）で入力する。 */
  | { readonly type: 'char'; readonly key: string }
  /** 固定表記の文字列をそのまま打ち込む（関数名ショートカット等。CAPS の影響を受けない）。 */
  | { readonly type: 'text'; readonly text: string }
  /** Enter 相当。 */
  | { readonly type: 'enter' }
  /** Backspace 相当。 */
  | { readonly type: 'backspace' }
  /** 矢印キー相当。既存の物理キーボードと同じ経路へそのまま渡す（現状は無反応。依頼「触らないこと」対象）。 */
  | { readonly type: 'arrow'; readonly key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' }
  /** CAPS ロックの切替。 */
  | { readonly type: 'capsToggle' }
  /** BASIC キー相当（PRO/RUN 切替）。 */
  | { readonly type: 'modeToggle' }
  /** ON(BREAK) キー相当。 */
  | { readonly type: 'break' }
  /** 未実装のキー。`name` を `?UNSUPPORTED <name>` として打ち込み、記録する。 */
  | { readonly type: 'unsupported'; readonly name: string };

/** 仮想キーボードに並べる1個のキー。 */
export interface VirtualKeyDef {
  /** キートップに表示する文字列。 */
  readonly label: string;
  readonly action: VirtualKeyAction;
  /** `label` だけでは意味が伝わらないキーに付ける読み上げ用の説明。 */
  readonly ariaLabel?: string;
}

/**
 * 仮想キーボードの行データ。実機写真から読み取れた配置に合わせている
 * （`G850/CLAUDE.md` 依頼の段組みと同じ並び）。
 *
 * 【写真から確実に読み取れず、未確定のまま `unsupported` としたキー】
 * `2ndF`（シフト層の内容が不明）、`F↔E`（表示形式切替の詳細が不明）、
 * `→DEG`（角度モード切替の対象・表示先が不明。`DEG` インジケータ自体も
 * 未実装）、`MDF`（BASIC 関数としては実装済みだが、キー単体の実機挙動が
 * 依頼で明示的に未確定指定）、`TEXT`/`CONST`/`ANS`/`OFF`/`カナ`（写真には
 * 存在が確認できるが機能の詳細記述が資料に無い）、`SHIFT`（記号入力等の
 * 2段目レイヤーの内容が不明）、`TAB`（ラインエディタでの意味が未定義）、
 * `INS`(DEL)（前方削除は未実装）、`R-CM`/`M+`/`M-`（電卓メモリ機能の詳細が不明）。
 */
const ROWS: readonly (readonly VirtualKeyDef[])[] = [
  // 最上段
  [
    { label: 'BASIC', action: { type: 'modeToggle' }, ariaLabel: 'BASIC（PRO/RUN 切替）' },
    { label: 'TEXT', action: { type: 'unsupported', name: 'TEXT' } },
    { label: 'CONST', action: { type: 'unsupported', name: 'CONST' } },
    { label: 'ANS', action: { type: 'unsupported', name: 'ANS' } },
    { label: 'OFF', action: { type: 'unsupported', name: 'OFF' } },
    { label: 'ON', action: { type: 'break' }, ariaLabel: 'ON（BREAK）' },
  ],
  // 2段目
  [
    { label: '2ndF', action: { type: 'unsupported', name: '2ndF' } },
    { label: 'sin', action: { type: 'text', text: 'SIN(' } },
    { label: 'cos', action: { type: 'text', text: 'COS(' } },
    { label: 'tan', action: { type: 'text', text: 'TAN(' } },
    { label: 'F↔E', action: { type: 'unsupported', name: 'F↔E' } },
    { label: 'CLS', action: { type: 'text', text: 'CLS' } },
  ],
  // 3段目
  [
    { label: 'nPr', action: { type: 'text', text: 'NPR(' } },
    { label: '→DEG', action: { type: 'unsupported', name: '→DEG' } },
    { label: 'ln', action: { type: 'text', text: 'LN(' } },
    { label: 'log', action: { type: 'text', text: 'LOG(' } },
    { label: '1/x', action: { type: 'text', text: 'RCP(' } },
    { label: 'MDF', action: { type: 'unsupported', name: 'MDF' } },
  ],
  // 4段目
  [
    { label: 'π', action: { type: 'text', text: 'PI' } },
    { label: '√', action: { type: 'text', text: 'SQR(' } },
    { label: 'x²', action: { type: 'text', text: 'SQU(' } },
    { label: 'yˣ', action: { type: 'char', key: '^' } },
    { label: '(', action: { type: 'char', key: '(' } },
    { label: ')', action: { type: 'char', key: ')' } },
  ],
  // 英字段(1): TAB〜P〜BS
  [
    { label: 'TAB', action: { type: 'unsupported', name: 'TAB' } },
    ...('QWERTYUIOP'.split('').map((ch) => letterKey(ch))),
    { label: 'BS', action: { type: 'backspace' } },
  ],
  // 英字段(2): CAPS〜L〜; 〜ENTER
  [
    { label: 'CAPS', action: { type: 'capsToggle' } },
    ...('ASDFGHJKL'.split('').map((ch) => letterKey(ch))),
    { label: ';', action: { type: 'char', key: ';' } },
    { label: 'ENTER', action: { type: 'enter' } },
  ],
  // 英字段(3): SHIFT〜M〜,〜↑
  [
    { label: 'SHIFT', action: { type: 'unsupported', name: 'SHIFT' } },
    ...('ZXCVBNM'.split('').map((ch) => letterKey(ch))),
    { label: ',', action: { type: 'char', key: ',' } },
    { label: '↑', action: { type: 'arrow', key: 'ArrowUp' }, ariaLabel: '上矢印' },
  ],
  // 英字段(4): カナ〜スペース〜INS〜←↓→
  [
    { label: 'カナ', action: { type: 'unsupported', name: 'カナ' } },
    { label: 'SPACE', action: { type: 'char', key: ' ' } },
    { label: 'INS', action: { type: 'unsupported', name: 'INS(DEL)' }, ariaLabel: 'INS(DEL)' },
    { label: '←', action: { type: 'arrow', key: 'ArrowLeft' }, ariaLabel: '左矢印' },
    { label: '↓', action: { type: 'arrow', key: 'ArrowDown' }, ariaLabel: '下矢印' },
    { label: '→', action: { type: 'arrow', key: 'ArrowRight' }, ariaLabel: '右矢印' },
  ],
  // テンキー
  [
    { label: '7', action: { type: 'char', key: '7' } },
    { label: '8', action: { type: 'char', key: '8' } },
    { label: '9', action: { type: 'char', key: '9' } },
    { label: '/', action: { type: 'char', key: '/' } },
    { label: 'R-CM', action: { type: 'unsupported', name: 'R-CM' } },
  ],
  [
    { label: '4', action: { type: 'char', key: '4' } },
    { label: '5', action: { type: 'char', key: '5' } },
    { label: '6', action: { type: 'char', key: '6' } },
    { label: '*', action: { type: 'char', key: '*' } },
    { label: 'M+', action: { type: 'unsupported', name: 'M+' } },
  ],
  [
    { label: '1', action: { type: 'char', key: '1' } },
    { label: '2', action: { type: 'char', key: '2' } },
    { label: '3', action: { type: 'char', key: '3' } },
    { label: '-', action: { type: 'char', key: '-' } },
    { label: 'M-', action: { type: 'unsupported', name: 'M-' } },
  ],
  [
    { label: '0', action: { type: 'char', key: '0' } },
    { label: '.', action: { type: 'char', key: '.' } },
    { label: '=', action: { type: 'char', key: '=' } },
    { label: '+', action: { type: 'char', key: '+' } },
  ],
];

/** 英字キー1個分の定義を作る（`ch` は大文字1文字。表示は大文字、実際の入力は CAPS 状態に従う）。 */
function letterKey(ch: string): VirtualKeyDef {
  return { label: ch, action: { type: 'char', key: ch.toLowerCase() } };
}

export { ROWS as VIRTUAL_KEYBOARD_ROWS };

/** `pressVirtualKey` が要求する最小限のコンテキスト。 */
export interface VirtualKeyboardContext {
  readonly machine: Machine;
  readonly directMode: DirectMode;
  /** 押下後に呼ぶ再描画コールバック（`ui/main.ts` の `renderAll` を想定）。 */
  readonly render: () => void;
}

/** `key`/`code` だけを持つ最小限の `KeyboardEvent` を作る（自動テスト用ブラウザの `code` 欠落と同じ形）。 */
function syntheticKeyEvent(key: string): KeyboardEvent {
  return { key, code: '' } as KeyboardEvent;
}

/**
 * 仮想キーが押されたときの処理本体。DOM に依存しないため、これ単体を
 * ノード環境から直接テストできる（`attachVirtualKeyboard` は DOM 組み立てだけを担う）。
 */
export function pressVirtualKey(ctx: VirtualKeyboardContext, action: VirtualKeyAction): void {
  switch (action.type) {
    case 'char':
    case 'enter':
    case 'backspace':
    case 'arrow': {
      const key =
        action.type === 'char'
          ? action.key
          : action.type === 'enter'
            ? 'Enter'
            : action.type === 'backspace'
              ? 'Backspace'
              : action.key;
      const e = syntheticKeyEvent(key);
      // 物理キーボードと完全に同じ経路（`ui/main.ts` の window keydown リスナー本体）。
      dispatchKeydown(ctx.machine, ctx.directMode, e);
      // クリック＝一瞬の押下として扱う。`keyup` も送って `Keyboard.pressed` に
      // 残留させない（`isPressed` を将来使う実装が誤検出しないための保険）。
      ctx.machine.keyboard.handleKeyUp(e);
      break;
    }
    case 'text':
      ctx.directMode.insertText(action.text);
      break;
    case 'capsToggle':
      ctx.machine.keyboard.setCapsLock(!ctx.machine.keyboard.isCapsLockOn());
      ctx.render();
      break;
    case 'modeToggle':
      ctx.directMode.toggleMode();
      break;
    case 'break':
      ctx.directMode.requestBreak();
      break;
    case 'unsupported':
      ctx.machine.reportUnimplemented(action.name);
      ctx.directMode.insertText(`?UNSUPPORTED ${action.name}`);
      break;
  }
}

/**
 * 仮想キーボードの DOM を `container` の中に組み立て、クリックを `pressVirtualKey`
 * へ配線する。`container` は空の `<div>` を想定し、既存の子要素は全て置き換える。
 *
 * 【判断した点・理由】 ボタンをマウスでクリックするとフォーカスが移り、以後の
 * `window` の `keydown` は `target` がそのボタン（`BUTTON` タグ）になる。
 * `isFormControlTarget` は `BUTTON` を「フォーム部品＝エミュレータへ渡さない」と
 * 判定するため、そのままだと**キーボードを1回クリックしただけで以後の物理
 * キー入力が届かなくなる**（依頼「キーボードが開いているとき、物理キーボードからの
 * 入力も従来どおり効くこと」に反する）。`mousedown` で `preventDefault()` して
 * そもそもフォーカスを移させないことで防ぐ（クリック自体は通常どおり発火する）。
 */
export function attachVirtualKeyboard(container: HTMLElement, ctx: VirtualKeyboardContext): void {
  container.replaceChildren();

  for (const row of ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'virtual-keyboard__row';
    for (const def of row) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'virtual-keyboard__key';
      if (def.action.type === 'unsupported') {
        btn.classList.add('virtual-keyboard__key--unsupported');
      }
      btn.textContent = def.label;
      btn.setAttribute('aria-label', def.ariaLabel ?? def.label);
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => pressVirtualKey(ctx, def.action));
      rowEl.appendChild(btn);
    }
    container.appendChild(rowEl);
  }
}
