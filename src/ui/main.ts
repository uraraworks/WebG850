// エントリポイント（プレースホルダ）。
// パーサ・インタプリタ・machine 一式は別担当が実装するため、
// ここでは「起動した」ことが分かる最小限の描画だけ行う。

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#screen');
  if (canvas === null) {
    throw new Error('#screen canvas が見つかりません');
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2d context を取得できません');
  }
  ctx.fillStyle = '#9ead86';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '8px monospace';
  ctx.fillText('WebG850', 2, 10);
}

main();
