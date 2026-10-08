const WIDTH = 1400;
const MARGIN = 40;
const SWATCH_WIDTH = (WIDTH - MARGIN * 2) / 5;
const SWATCH_HEIGHT = 110;
const ROW_HEIGHT = 180;
const FIRST_ROW_Y = 120;
const FONT = 'Arial, "Microsoft YaHei", sans-serif';
const DEFAULT_TITLE = '课程配色色板';

function normalizeHex(value: string): string {
  const hex = String(value).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex
      .split('')
      .map(channel => channel + channel)
      .join('')
      .toUpperCase()}`;
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`无法导出：无效的颜色 ${String(value).slice(0, 24)}`);
  }
  return `#${hex.toUpperCase()}`;
}

function preparePalette(colors: string[], textColor: string, title: string) {
  if (colors.length < 1 || colors.length > 25) {
    throw new Error('色板导出需要 1–25 个颜色。');
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    colors: colors.map(normalizeHex),
    textColor: normalizeHex(textColor),
    title: String(title).trim().slice(0, 40) || DEFAULT_TITLE,
    height: FIRST_ROW_Y + Math.ceil(colors.length / 5) * ROW_HEIGHT + 80,
    date,
  };
}

function safeFilename(value: string, extension: string): string {
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  const base = cleaned || 'course-palette';
  const protectedBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `palette-${base}` : base;
  return protectedBase.toLowerCase().endsWith(extension) ? protectedBase : `${protectedBase}${extension}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the URL alive while browsers begin saving the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
}

export function exportJson(data: unknown, filename = 'course-palette.json'): void {
  const json = JSON.stringify(data, null, 2);
  if (json === undefined) {
    throw new Error('无法导出：数据不能序列化为 JSON。');
  }
  downloadBlob(new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' }), safeFilename(filename, '.json'));
}

export function exportSvg(colors: string[], textColor: string, title = DEFAULT_TITLE): void {
  const palette = preparePalette(colors, textColor, title);
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${palette.height}" viewBox="0 0 ${WIDTH} ${palette.height}" role="img" aria-labelledby="palette-title palette-description">`,
    `<title id="palette-title">${escapeXml(palette.title)}</title>`,
    `<desc id="palette-description">${palette.colors.length} 个颜色，依次排列为 ${Math.ceil(palette.colors.length / 5)} 行，每行至多五色。文字颜色 ${palette.textColor}。</desc>`,
    `<rect width="${WIDTH}" height="${palette.height}" fill="#F5F5F4"/>`,
    `<g font-family='${escapeXml(FONT)}'>`,
    `<text x="${MARGIN}" y="53" font-size="29" font-weight="700" fill="#202524">${escapeXml(palette.title)}</text>`,
    `<text x="${MARGIN}" y="84" font-size="14" fill="#65716D">${palette.colors.length} COLORS · 文字 ${palette.textColor} · ${palette.date}</text>`,
  ];

  palette.colors.forEach((color, index) => {
    const x = MARGIN + (index % 5) * SWATCH_WIDTH;
    const y = FIRST_ROW_Y + Math.floor(index / 5) * ROW_HEIGHT;
    const number = String(index + 1).padStart(2, '0');
    parts.push(
      `<g id="course-color-${number}" aria-label="${number} ${color}">`,
      `<rect x="${x}" y="${y}" width="${SWATCH_WIDTH}" height="${SWATCH_HEIGHT}" fill="${color}"/>`,
      `<text x="${x + 18}" y="${y + 64}" font-size="19" font-weight="600" fill="${palette.textColor}">Aa 课程</text>`,
      `<text x="${x + 18}" y="${y + SWATCH_HEIGHT + 31}" font-size="23" font-weight="700" fill="#202524">${number}</text>`,
      `<text x="${x + 18}" y="${y + SWATCH_HEIGHT + 58}" font-size="18" fill="#65716D">${color}</text>`,
      '</g>',
    );
  });

  parts.push(
    `<text x="${MARGIN}" y="${palette.height - 36}" font-size="13" fill="#65716D">色序 · Course Color Studio / sRGB · 颜色编号对应 JSON 中的顺序</text>`,
    '</g></svg>',
  );
  downloadBlob(
    new Blob([parts.join('\n')], { type: 'image/svg+xml;charset=utf-8' }),
    safeFilename(palette.title, '.svg'),
  );
}

export function exportPng(colors: string[], textColor: string, title = DEFAULT_TITLE): void {
  const palette = preparePalette(colors, textColor, title);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = palette.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器无法创建色板图像。');
  }

  context.fillStyle = '#F5F5F4';
  context.fillRect(0, 0, WIDTH, palette.height);
  context.fillStyle = '#202524';
  context.font = `700 29px ${FONT}`;
  context.fillText(palette.title, MARGIN, 53);
  context.fillStyle = '#65716D';
  context.font = `14px ${FONT}`;
  context.fillText(`${palette.colors.length} COLORS · 文字 ${palette.textColor} · ${palette.date}`, MARGIN, 84);

  palette.colors.forEach((color, index) => {
    const x = MARGIN + (index % 5) * SWATCH_WIDTH;
    const y = FIRST_ROW_Y + Math.floor(index / 5) * ROW_HEIGHT;
    context.fillStyle = color;
    context.fillRect(x, y, SWATCH_WIDTH, SWATCH_HEIGHT);
    context.fillStyle = palette.textColor;
    context.font = `600 19px ${FONT}`;
    context.fillText('Aa 课程', x + 18, y + 64);
    context.fillStyle = '#202524';
    context.font = `700 23px ${FONT}`;
    context.fillText(String(index + 1).padStart(2, '0'), x + 18, y + SWATCH_HEIGHT + 31);
    context.fillStyle = '#65716D';
    context.font = `18px ${FONT}`;
    context.fillText(color, x + 18, y + SWATCH_HEIGHT + 58);
  });

  context.font = `13px ${FONT}`;
  context.fillText('色序 · Course Color Studio / sRGB · 颜色编号对应 JSON 中的顺序', MARGIN, palette.height - 36);
  canvas.toBlob(blob => {
    if (blob) {
      downloadBlob(blob, safeFilename(palette.title, '.png'));
    } else {
      window.alert('浏览器未能生成 PNG，请尝试导出 SVG。');
    }
  }, 'image/png');
}
