// A few flash designs drawn in code, so the editor is playable before you
// upload anything.
function make(size, draw) {
  const c = document.createElement('canvas');
  c.width = size[0];
  c.height = size[1];
  const ctx = c.getContext('2d');
  ctx.strokeStyle = ctx.fillStyle = '#15181d';
  ctx.lineCap = ctx.lineJoin = 'round';
  draw(ctx, c.width, c.height);
  return c;
}

export const SAMPLES = [
  {
    name: 'Mandala',
    size: 0.13,
    make: () =>
      make([512, 512], (ctx, w) => {
        ctx.translate(w / 2, w / 2);
        ctx.lineWidth = 5;
        for (const [n, r0, r1, bulge] of [[8, 30, 110, 34], [16, 110, 180, 26], [16, 180, 236, 30]]) {
          for (let i = 0; i < n; i++) {
            ctx.save();
            ctx.rotate((i / n) * Math.PI * 2);
            ctx.beginPath();
            ctx.moveTo(0, -r0);
            ctx.quadraticCurveTo(bulge, -(r0 + r1) / 2, 0, -r1);
            ctx.quadraticCurveTo(-bulge, -(r0 + r1) / 2, 0, -r0);
            ctx.stroke();
            ctx.restore();
          }
        }
        for (const r of [30, 110, 180]) {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 16; i++) {
          const a = ((i + 0.5) / 16) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 246, Math.sin(a) * 246, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
  },
  {
    name: 'Bolt',
    size: 0.06,
    make: () =>
      make([256, 512], (ctx) => {
        ctx.beginPath();
        for (const [i, [x, y]] of [[150, 16], [40, 280], [118, 280], [84, 496], [220, 210], [136, 210], [196, 16]].entries()) {
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }),
  },
  {
    name: 'Arm band',
    size: 0.2,
    make: () =>
      make([1024, 200], (ctx, w, h) => {
        ctx.fillRect(0, 20, w, 22);
        ctx.fillRect(0, h - 42, w, 22);
        const n = 16;
        const step = w / n;
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.moveTo(i * step + 6, h - 56);
          ctx.lineTo(i * step + step / 2, 58);
          ctx.lineTo((i + 1) * step - 6, h - 56);
          ctx.closePath();
          ctx.fill();
        }
      }),
  },
  {
    name: 'Script',
    size: 0.16,
    make: () =>
      make([768, 256], (ctx, w, h) => {
        ctx.font = 'italic 600 150px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('stay wild', w / 2, h / 2, w - 40);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(120, h - 40);
        ctx.quadraticCurveTo(w / 2, h - 6, w - 120, h - 44);
        ctx.stroke();
      }),
  },
];
