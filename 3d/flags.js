// 로켓에 붙이는 깃발·마크 그리기 (캔버스). 실제 국기는 단순화해서 그림
export const FLAGS = [
  { id: 'KR', name: '대한민국' }, { id: 'US', name: '미국' }, { id: 'JP', name: '일본' }, { id: 'GB', name: '영국' },
  { id: 'FR', name: '프랑스' }, { id: 'DE', name: '독일' }, { id: 'IT', name: '이탈리아' },
  { id: 'EARTH', name: '지구 연합 (가상)' }, { id: 'CAT', name: '냥이 우주단 (재미)' }, { id: 'NONE', name: '없음' },
];

function star(c, x, y, r, n = 5, inner = 0.42) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * inner : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill();
}

// (x, y, w, h) 영역에 깃발을 그린다
export function drawFlag(c, id, x, y, w, h) {
  c.save(); c.translate(x, y);
  const stripes = (cols, vertical) => cols.forEach((col, i) => { c.fillStyle = col; if (vertical) c.fillRect(i * w / cols.length, 0, w / cols.length + 1, h); else c.fillRect(0, i * h / cols.length, w, h / cols.length + 1); });
  switch (id) {
    case 'KR': {
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, r = h / 4, ang = Math.atan2(h, w);
      c.save(); c.translate(cx, cy); c.rotate(ang);
      c.fillStyle = '#cd2e3a'; c.beginPath(); c.arc(0, 0, r, Math.PI, 0); c.fill();
      c.fillStyle = '#0047a0'; c.beginPath(); c.arc(0, 0, r, 0, Math.PI); c.fill();
      c.fillStyle = '#cd2e3a'; c.beginPath(); c.arc(-r / 2, 0, r / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0047a0'; c.beginPath(); c.arc(r / 2, 0, r / 2, 0, Math.PI * 2); c.fill();
      c.restore();
      // 4괘: 건(좌상) 곤(우하) 감(우상) 리(좌하) — true = 이어진 막대
      const tri = { tl: [true, true, true], br: [false, false, false], tr: [false, true, false], bl: [true, false, true] };
      const bw = r * 1.0, bh = r / 6, gap = r / 12, d = r * 1.72;
      for (const [k, sx, sy] of [['tl', -1, -1], ['tr', 1, -1], ['bl', -1, 1], ['br', 1, 1]]) {
        const dir = Math.atan2(sy * h, sx * w);
        c.save(); c.translate(cx + Math.cos(dir) * d, cy + Math.sin(dir) * d); c.rotate(dir + Math.PI / 2);
        c.fillStyle = '#000';
        tri[k].forEach((solid, i) => {
          const yy = (i - 1) * (bh + gap) - bh / 2;
          if (solid) c.fillRect(-bw / 2, yy, bw, bh);
          else { c.fillRect(-bw / 2, yy, bw * 0.45, bh); c.fillRect(bw * 0.05, yy, bw * 0.45, bh); }
        });
        c.restore();
      }
      break;
    }
    case 'US': {
      for (let i = 0; i < 13; i++) { c.fillStyle = i % 2 ? '#fff' : '#b22234'; c.fillRect(0, i * h / 13, w, h / 13 + 1); }
      const cw = w * 0.4, ch = h * 7 / 13; c.fillStyle = '#3c3b6e'; c.fillRect(0, 0, cw, ch);
      c.fillStyle = '#fff';
      for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) star(c, (k + (r % 2 ? 1 : 0.5)) * cw / 6, (r + 0.5) * ch / 9, ch / 22);
      break;
    }
    case 'JP': c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#bc002d'; c.beginPath(); c.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2); c.fill(); break;
    case 'GB': {
      c.fillStyle = '#012169'; c.fillRect(0, 0, w, h);
      c.lineCap = 'butt';
      c.strokeStyle = '#fff'; c.lineWidth = h / 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
      c.strokeStyle = '#c8102e'; c.lineWidth = h / 15; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
      c.fillStyle = '#fff'; c.fillRect(w / 2 - h / 6, 0, h / 3, h); c.fillRect(0, h / 3, w, h / 3);
      c.fillStyle = '#c8102e'; c.fillRect(w / 2 - h / 10, 0, h / 5, h); c.fillRect(0, h * 0.4, w, h / 5);
      break;
    }
    case 'FR': stripes(['#0055a4', '#fff', '#ef4135'], true); break;
    case 'IT': stripes(['#009246', '#fff', '#ce2b37'], true); break;
    case 'DE': stripes(['#000', '#dd0000', '#ffce00'], false); break;
    case 'EARTH': {
      c.fillStyle = '#123a73'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#fff'; c.lineWidth = h / 28;
      c.beginPath(); c.ellipse(w / 2, h / 2, h * 0.42, h * 0.14, -0.35, 0, Math.PI * 2); c.stroke();
      const g = c.createRadialGradient(w / 2 - h * 0.08, h / 2 - h * 0.08, 2, w / 2, h / 2, h * 0.24);
      g.addColorStop(0, '#7fd0ff'); g.addColorStop(1, '#1f6fb0');
      c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, h * 0.24, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#4caf50'; c.beginPath(); c.ellipse(w / 2 - h * 0.05, h / 2 - h * 0.03, h * 0.1, h * 0.07, 0.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; star(c, w * 0.85, h * 0.2, h * 0.07);
      break;
    }
    case 'CAT': {
      c.fillStyle = '#ffd1dc'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#7a3e9d';
      c.beginPath(); c.ellipse(w / 2, h * 0.62, h * 0.2, h * 0.16, 0, 0, Math.PI * 2); c.fill();
      [[-0.2, 0.32], [-0.07, 0.24], [0.07, 0.24], [0.2, 0.32]].forEach(([dx, dy]) => { c.beginPath(); c.ellipse(w / 2 + dx * h, dy * h, h * 0.07, h * 0.09, 0, 0, Math.PI * 2); c.fill(); });
      break;
    }
    default: break;
  }
  if (id !== 'NONE') { c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); }
  c.restore();
}

// 로켓 몸통에 붙일 데칼: 위쪽에 깃발, 아래쪽에 세로 이름 (투명 배경)
export function decalCanvas(flag, name, mark, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024;
  const c = cv.getContext('2d');
  let y = 16;
  if (flag && flag !== 'NONE') { drawFlag(c, flag, 28, y, 200, 133); y += 160; }
  if (mark) { c.font = '120px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; c.textAlign = 'center'; c.fillText(mark, 128, y + 110); y += 150; }
  if (name) {
    c.fillStyle = color || '#141518';
    c.font = 'bold 70px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const chars = [...name].slice(0, 9);
    const step = Math.min(84, (1000 - y) / Math.max(1, chars.length));
    chars.forEach((ch, i) => c.fillText(ch, 128, y + step * (i + 0.5)));
  }
  return cv;
}

export function flagThumb(id) {
  const cv = document.createElement('canvas'); cv.width = 60; cv.height = 40;
  drawFlag(cv.getContext('2d'), id, 0, 0, 60, 40);
  return cv.toDataURL();
}
