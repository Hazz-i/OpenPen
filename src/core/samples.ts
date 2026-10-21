/**
 * Built-in, offline design templates. Every node is absolutely positioned so
 * the Canvas2D renderer produces exactly the same layout every time.
 */
import type { PenDocument, PenNode } from './types';
import { PEN_VERSION } from './format';
import { uid } from './store';

export interface Sample {
  id: string;
  name: string;
  doc: PenDocument;
  prompt: string;
}

type TextOpts = {
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  italic?: boolean;
};

function t(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  size: number,
  weight: string,
  color: string,
  opts: TextOpts = {},
): PenNode {
  const node: PenNode = {
    type: 'text',
    id: uid('tx'),
    name,
    x,
    y,
    width: w,
    height: h,
    content,
    fontFamily: 'Inter',
    fontSize: size,
    fontWeight: weight,
    lineHeight: opts.lineHeight ?? 1.2,
    fill: color,
    textGrowth: 'fixed-width-height',
    layout: 'none',
  };
  if (opts.align) node.textAlign = opts.align;
  if (opts.letterSpacing != null) node.letterSpacing = opts.letterSpacing;
  if (opts.italic) node.fontStyle = 'italic';
  return node;
}

function r(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | null,
  radius = 0,
  extra: Partial<PenNode> = {},
): PenNode {
  const node: PenNode = {
    type: 'rectangle',
    id: uid('rc'),
    name,
    x,
    y,
    width: w,
    height: h,
    layout: 'none',
    ...extra,
  };
  if (fill !== null) node.fill = fill;
  if (radius) node.cornerRadius = radius;
  return node;
}

function e(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | null,
  extra: Partial<PenNode> = {},
): PenNode {
  const node: PenNode = {
    type: 'ellipse',
    id: uid('el'),
    name,
    x,
    y,
    width: w,
    height: h,
    layout: 'none',
    ...extra,
  };
  if (fill !== null) node.fill = fill;
  return node;
}

function fr(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | null,
  children: PenNode[],
  extra: Partial<PenNode> = {},
): PenNode {
  const node: PenNode = {
    type: 'frame',
    id: uid('fr'),
    name,
    x,
    y,
    width: w,
    height: h,
    fill: fill ?? undefined,
    clip: true,
    layout: 'none',
    children,
    ...extra,
  };
  return node;
}

function doc(children: PenNode[]): PenDocument {
  return { version: PEN_VERSION, children };
}

function line(name: string, x: number, y: number, w: number, h: number, color: string): PenNode {
  return r(name, x, y, w, h, color);
}

/* ------------------------------------------------------------------ */
/* Welcome                                                            */
/* ------------------------------------------------------------------ */

function welcomeDoc(): PenDocument {
  const cream = '#F4F0E6';
  const ink = '#16150F';
  const muted = '#6B675C';
  const orange = '#FF5A1F';
  const hairline = '#DED7C8';

  const artboard = fr(
    'Hero artboard',
    286,
    792,
    626,
    344,
    '#1C1B18',
    [
      t('Artboard headline', 34, 48, 360, 110, 'A calmer way\nto plan your day.', 36, '600', '#FAF7EF', {
        lineHeight: 1.14,
        letterSpacing: -1.2,
      }),
      t(
        'Artboard sub',
        34,
        176,
        250,
        54,
        'One place for your tasks, notes and the small things that matter.',
        13,
        '400',
        '#A9A396',
        { lineHeight: 1.5 },
      ),
      r('Artboard CTA', 34, 250, 124, 38, orange, 19),
      t('Artboard CTA label', 34, 260, 124, 18, 'Get the app', 11, '600', '#FFFFFF', { align: 'center' }),
      e('Orange blob', 404, 108, 170, 170, orange),
      r('Floating task card', 404, 168, 164, 96, '#FFFFFF', 12),
      t('Task label', 420, 184, 90, 14, 'TODAY', 9, '600', '#8A8578', { letterSpacing: 1.1 }),
      t('Task title', 420, 202, 130, 22, '3 of 5 done', 15, '600', '#16150F'),
      r('Task track', 420, 234, 132, 6, '#EEE9DD', 3),
      r('Task fill', 420, 234, 88, 6, orange, 3),
      t('Canvas label', 14, 14, 220, 16, 'Home / Mobile', 10, '500', '#8A8578'),
    ],
    { cornerRadius: 16 },
  );

  return doc([
    fr('Welcome', 0, 0, 1000, 1458, cream, [
      // top navigation
      r('Logo tile', 64, 64, 44, 44, '#1C1B18', 12),
      t('Logo glyph', 64, 74, 44, 26, 'p', 22, '700', cream, { align: 'center' }),
      t('Wordmark', 120, 75, 130, 24, 'pencil', 20, '600', ink, { letterSpacing: -0.4 }),
      t('Nav templates', 552, 78, 88, 18, 'Templates', 13, '500', muted),
      t('Nav docs', 660, 78, 56, 18, 'Docs', 13, '500', muted),
      t('Nav changelog', 736, 78, 86, 18, 'Changelog', 13, '500', muted),
      r('Top CTA', 836, 62, 100, 40, '#1C1B18', 20),
      t('Top CTA label', 836, 73, 100, 18, 'Open app', 12, '600', '#FFFFFF', { align: 'center' }),

      // hero copy
      t('Eyebrow', 64, 194, 500, 18, 'AI-NATIVE DESIGN TOOL', 11, '700', orange, {
        letterSpacing: 1.8,
      }),
      t('Hero headline', 64, 226, 900, 250, "Make it real\nbefore it's built.", 88, '600', ink, {
        lineHeight: 1.02,
        letterSpacing: -3.2,
      }),
      t(
        'Hero body',
        64,
        506,
        540,
        72,
        'Pencil turns plain language into editable screens. Describe the product, get a polished design in seconds.',
        18,
        '400',
        '#5D5A50',
        { lineHeight: 1.55 },
      ),
      r('Primary CTA', 64, 604, 198, 54, orange, 27),
      t('Primary CTA label', 64, 621, 198, 20, 'Start designing', 15, '600', '#FFFFFF', {
        align: 'center',
      }),
      t('Secondary CTA', 286, 622, 190, 22, 'Watch the film  ↗', 15, '500', ink),
      t('Secondary caption', 286, 648, 190, 16, '2 min product tour', 11, '400', '#8A8578'),

      // editor mock
      r('Editor window', 64, 720, 872, 430, '#FFFFFF', 20, {
        stroke: '#E0D9CA',
        strokeWidth: 1,
      }),
      r('Editor top bar', 64, 720, 872, 44, '#FBF8F1', 20),
      e('Window dot 1', 88, 738, 8, 8, '#E8B4A2'),
      e('Window dot 2', 102, 738, 8, 8, '#EBD79E'),
      e('Window dot 3', 116, 738, 8, 8, '#B7CFA5'),
      t('Window title', 380, 736, 240, 16, 'pencil — new project', 10, '500', '#8A8578', {
        align: 'center',
      }),
      line('Editor divider', 64, 764, 872, 1, '#EDE8DC'),
      r('Editor sidebar', 64, 765, 190, 385, '#FBF9F4'),
      t('Sidebar label', 86, 790, 120, 14, 'PAGES', 9, '600', '#A29C8E', { letterSpacing: 1.3 }),
      r('Active page', 78, 814, 162, 30, '#FFEDE6', 8),
      t('Active page label', 92, 822, 100, 16, 'Home', 12, '600', orange),
      t('Sidebar product', 92, 858, 100, 16, 'Product', 12, '400', muted),
      t('Sidebar pricing', 92, 890, 100, 16, 'Pricing', 12, '400', muted),
      t('Sidebar about', 92, 922, 100, 16, 'About', 12, '400', muted),
      line('Sidebar sep', 78, 966, 162, 1, '#ECE6D8'),
      t('Sidebar assets', 86, 986, 120, 14, 'LAYERS', 9, '600', '#A29C8E', { letterSpacing: 1.3 }),
      t('Sidebar layer 1', 92, 1012, 130, 16, 'Hero section', 12, '400', muted),
      t('Sidebar layer 2', 92, 1040, 130, 16, 'Navigation', 12, '400', muted),
      t('Sidebar layer 3', 92, 1068, 130, 16, 'Footer', 12, '400', muted),
      artboard,

      // why pencil
      t('Why label', 64, 1194, 300, 16, 'WHY PENCIL', 11, '700', orange, { letterSpacing: 1.8 }),
      t('Why heading', 64, 1218, 900, 44, 'Less dragging. More deciding.', 32, '600', ink, {
        letterSpacing: -1,
      }),
      r('Feature icon 1', 64, 1290, 38, 38, '#FFE3D9', 11),
      t('Feature icon glyph 1', 64, 1298, 38, 22, '⌘', 17, '600', orange, { align: 'center' }),
      t('Feature title 1', 64, 1340, 280, 22, 'Prompt to screen', 16, '600', ink),
      t(
        'Feature body 1',
        64,
        1366,
        280,
        42,
        'Type a sentence. Get a real, editable layout instead of a moodboard.',
        13,
        '400',
        muted,
        { lineHeight: 1.5 },
      ),
      r('Feature icon 2', 402, 1290, 38, 38, '#E9E2D2', 11),
      t('Feature icon glyph 2', 402, 1298, 38, 22, '▦', 15, '600', '#6B675C', { align: 'center' }),
      t('Feature title 2', 402, 1340, 280, 22, 'Every layer is yours', 16, '600', ink),
      t(
        'Feature body 2',
        402,
        1366,
        280,
        42,
        'Move, restyle and rewrite anything. The file is ordinary JSON.',
        13,
        '400',
        muted,
        { lineHeight: 1.5 },
      ),
      r('Feature icon 3', 740, 1290, 38, 38, '#E6E9D4', 11),
      t('Feature icon glyph 3', 740, 1298, 38, 22, '</>', 11, '600', '#5E6440', { align: 'center' }),
      t('Feature title 3', 740, 1340, 280, 22, 'Export clean HTML', 16, '600', ink),
      t(
        'Feature body 3',
        740,
        1366,
        280,
        42,
        'Ship absolutely-positioned markup, not a screenshot or a locked export.',
        13,
        '400',
        muted,
        { lineHeight: 1.5 },
      ),

      line('Footer rule', 64, 1420, 872, 1, hairline),
      t('Footer left', 64, 1432, 420, 16, 'pencil — design at the speed of thought', 11, '400', '#8A8578'),
      t('Footer right', 736, 1432, 200, 16, 'Made for the web', 11, '500', '#8A8578', {
        align: 'right',
      }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Landing page                                                       */
/* ------------------------------------------------------------------ */

function landingDoc(): PenDocument {
  const bg = '#F7F7F4';
  const ink = '#0F0F12';
  const muted = '#5B5B55';
  const accent = '#4F46E5';
  const hair = '#E1E0D8';

  const miniStat = (name: string, x: number, label: string, value: string) =>
    fr(name, x, 150, 110, 64, '#F7F6F0', [
      t(`${name} label`, 12, 10, 86, 14, label, 9, '500', '#7C7C73'),
      t(`${name} value`, 12, 26, 86, 24, value, 17, '600', '#111111'),
    ], { cornerRadius: 10 });

  const navItem = (name: string, x: number, label: string) =>
    t(name, x, 52, 92, 20, label, 14, '500', '#4B4B45');

  const featureCard = (
    name: string,
    x: number,
    tint: string,
    glyph: string,
    title: string,
    body: string,
  ) =>
    fr(name, x, 884, 406, 244, '#FFFFFF', [
      r(`${name} icon bg`, 24, 24, 46, 46, tint, 13),
      t(`${name} glyph`, 24, 36, 46, 22, glyph, 17, '600', accent, { align: 'center' }),
      t(`${name} title`, 24, 90, 340, 28, title, 19, '600', ink, { letterSpacing: -0.3 }),
      t(`${name} body`, 24, 126, 340, 82, body, 14, '400', muted, { lineHeight: 1.55 }),
      t(`${name} link`, 24, 208, 200, 18, 'Learn more  →', 12, '600', accent),
    ], { cornerRadius: 20, stroke: hair, strokeWidth: 1 });

  const bars = [34, 52, 42, 68, 56, 78, 66, 92];
  const barNodes: PenNode[] = bars.map((height, i) =>
    r(
      `Chart bar ${i + 1}`,
      156 + i * 42,
      386 - height,
      24,
      height,
      i === bars.length - 1 ? accent : i % 3 === 0 ? '#C7C4F5' : '#E4E3F8',
      6,
    ),
  );

  return doc([
    fr('Landing', 0, 0, 1440, 1200, bg, [
      // header
      r('Logo tile', 80, 44, 36, 36, ink, 10),
      t('Logo glyph', 80, 51, 36, 22, 'n', 18, '700', '#FFFFFF', { align: 'center' }),
      t('Wordmark', 130, 52, 140, 24, 'Northstar', 18, '700', ink, { letterSpacing: -0.4 }),
      navItem('Nav product', 604, 'Product'),
      navItem('Nav solutions', 696, 'Solutions'),
      navItem('Nav pricing', 800, 'Pricing'),
      navItem('Nav changelog', 880, 'Changelog'),
      t('Sign in', 1200, 52, 60, 20, 'Sign in', 14, '500', '#4B4B45'),
      r('Header CTA', 1280, 38, 104, 40, ink, 10),
      t('Header CTA label', 1280, 49, 104, 18, 'Get started', 13, '600', '#FFFFFF', {
        align: 'center',
      }),

      // hero
      r('Hero badge', 80, 160, 240, 32, '#ECEBE4', 16),
      e('Badge dot', 94, 172, 8, 8, accent),
      t('Badge text', 110, 168, 200, 18, 'NEW · AI LAYOUT ENGINE', 10, '600', '#4B4B45', {
        letterSpacing: 1.1,
      }),
      t('Hero headline', 80, 216, 660, 220, 'Design systems that build themselves.', 68, '600', ink, {
        lineHeight: 1.04,
        letterSpacing: -2.8,
      }),
      t(
        'Hero body',
        80,
        450,
        520,
        82,
        'Northstar turns your product language into production-ready screens, tokens and components. No handoff. No drift.',
        17,
        '400',
        muted,
        { lineHeight: 1.6 },
      ),
      r('Hero primary', 80, 556, 178, 52, accent, 12),
      t('Hero primary label', 80, 571, 178, 20, 'Start free', 15, '600', '#FFFFFF', {
        align: 'center',
      }),
      r('Hero secondary', 274, 556, 170, 52, '#FFFFFF', 12, {
        stroke: '#D9D8D0',
        strokeWidth: 1,
      }),
      t('Hero secondary label', 274, 571, 170, 20, 'Book a demo', 15, '600', ink, {
        align: 'center',
      }),
      t('Hero caption', 80, 626, 420, 16, 'Free for 3 projects · No credit card required', 12, '400', '#8A8A82'),

      // product panel
      fr('Product panel', 790, 160, 570, 480, '#0E0E12', [
        e('Panel dot 1', 22, 20, 8, 8, '#3A3A44'),
        e('Panel dot 2', 36, 20, 8, 8, '#2C2C35'),
        e('Panel dot 3', 50, 20, 8, 8, '#25252D'),
        t('Panel theme', 22, 44, 260, 16, 'Theme / Obsidian', 10, '500', '#8B8B96'),
        t('Panel live', 500, 44, 48, 16, 'LIVE', 9, '600', '#8FBF5A', { align: 'right' }),

        r('Mini app', 22, 78, 526, 346, '#F6F5EF', 16),
        r('Mini sidebar', 22, 78, 110, 346, '#EEEDE5', 16),
        t('Mini logo', 40, 96, 60, 16, 'north', 11, '700', '#111111'),
        t('Mini nav 1', 40, 130, 74, 14, 'Overview', 9, '600', '#111111'),
        t('Mini nav 2', 40, 154, 74, 14, 'Projects', 9, '400', '#8B8B84'),
        t('Mini nav 3', 40, 178, 74, 14, 'Tokens', 9, '400', '#8B8B84'),
        t('Mini nav 4', 40, 202, 74, 14, 'Settings', 9, '400', '#8B8B84'),
        r('Mini upgrade', 36, 366, 82, 32, '#111111', 8),
        t('Mini upgrade label', 36, 375, 82, 14, 'Upgrade', 8, '600', '#FFFFFF', { align: 'center' }),

        t('Mini title', 156, 98, 200, 22, 'Overview', 15, '600', '#111111'),
        t('Mini subtitle', 156, 122, 260, 14, 'Everything your team shipped this week.', 9, '400', '#8B8B84'),
        miniStat('Mini stat users', 156, 'ACTIVE USERS', '24.8k'),
        miniStat('Mini stat revenue', 278, 'REVENUE', '$128k'),
        miniStat('Mini stat churn', 400, 'CHURN', '1.9%'),

        t('Mini chart label', 156, 234, 180, 14, 'Weekly activity', 9, '600', '#111111'),
        ...barNodes.map((bar) => ({ ...bar })),
        line('Mini chart base', 156, 388, 360, 1, '#DBDAD2'),
        t('Mini chart mon', 156, 396, 30, 12, 'MON', 7, '500', '#9A9A92'),
        t('Mini chart fri', 366, 396, 30, 12, 'FRI', 7, '500', '#9A9A92'),
        t('Mini chart sun', 486, 396, 30, 12, 'SUN', 7, '500', '#9A9A92'),
      ], { cornerRadius: 24 }),

      fr('Sync chip', 738, 558, 196, 66, '#FFFFFF', [
        e('Sync dot', 16, 25, 16, 16, '#B7E27A'),
        t('Sync title', 44, 16, 140, 18, 'Components synced', 11, '600', '#111111'),
        t('Sync sub', 44, 35, 140, 14, 'Just now · 42 tokens', 9, '400', '#8B8B84'),
      ], { cornerRadius: 14, stroke: '#E4E3DB', strokeWidth: 1 }),

      // trusted by
      t('Trust label', 80, 714, 260, 14, 'TRUSTED BY PRODUCT TEAMS AT', 10, '600', '#8A8A82', {
        letterSpacing: 1.4,
      }),
      t('Trust 1', 430, 708, 100, 24, 'Vercel', 16, '600', '#A3A39A'),
      t('Trust 2', 560, 708, 100, 24, 'Linear', 16, '600', '#A3A39A'),
      t('Trust 3', 690, 708, 100, 24, 'Ramp', 16, '600', '#A3A39A'),
      t('Trust 4', 810, 708, 100, 24, 'Notion', 16, '600', '#A3A39A'),
      t('Trust 5', 940, 708, 100, 24, 'Figma', 16, '600', '#A3A39A'),

      // features
      t('Section eyebrow', 80, 792, 300, 16, 'BUILT FOR MOMENTUM', 10, '700', accent, {
        letterSpacing: 1.5,
      }),
      t('Section title', 80, 816, 620, 52, 'Everything stays in sync.', 40, '600', ink, {
        letterSpacing: -1.4,
      }),
      t(
        'Section body',
        880,
        824,
        480,
        54,
        'One source of truth for screens, components and the rules that hold them together.',
        14,
        '400',
        muted,
        { lineHeight: 1.55 },
      ),

      featureCard(
        'Feature design',
        80,
        '#EDEBFF',
        '◈',
        'Design in the open',
        'Real screens, real content. Share a link before the file is finished and collect feedback in context.',
      ),
      featureCard(
        'Feature tokens',
        517,
        '#EDF5E4',
        '⌗',
        'Tokens that travel',
        'Colors, type and spacing become variables your engineers can consume directly. Change once, update everywhere.',
      ),
      featureCard(
        'Feature handoff',
        954,
        '#FFF0E6',
        '↗',
        'Handoff without the PDF',
        'Export clean HTML or copy a single component. What you approve is exactly what gets built.',
      ),

      line('Footer rule', 80, 1160, 1280, 1, hair),
      t('Footer left', 80, 1174, 400, 16, '© 2026 Northstar Labs', 11, '400', '#8A8A82'),
      t('Footer right', 1080, 1174, 280, 16, 'Privacy · Terms · Status', 11, '400', '#8A8A82', {
        align: 'right',
      }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Mobile app (three screens)                                         */
/* ------------------------------------------------------------------ */

function mobileDoc(): PenDocument {
  const bg = '#0C0F14';
  const card = '#151B23';
  const white = '#F4F5F2';
  const muted = '#7C8794';
  const lime = '#D7F36A';
  const hair = '#222B35';

  const statusBar = (): PenNode[] => [
    t('Status time', 24, 18, 60, 16, '9:41', 12, '600', white),
    r('Signal 1', 300, 25, 3, 6, '#8C97A3', 1),
    r('Signal 2', 306, 22, 3, 9, '#8C97A3', 1),
    r('Signal 3', 312, 19, 3, 12, '#8C97A3', 1),
    r('Battery shell', 336, 21, 22, 11, null, 3, { stroke: '#8C97A3', strokeWidth: 1 }),
    r('Battery fill', 339, 24, 14, 5, '#8C97A3', 1),
  ];

  const nav = (active: number): PenNode => {
    const labels = ['Home', 'Insights', 'Plan', 'Profile'];
    const children: PenNode[] = [];
    labels.forEach((label, i) => {
      const x = 20 + i * 78;
      if (i === active) children.push(e(`${label} active dot`, x + 26, 10, 5, 5, lime));
      children.push(
        t(`${label} tab`, x, 24, 58, 16, label, 10, i === active ? '600' : '500', i === active ? lime : '#6C7783', {
          align: 'center',
        }),
      );
    });
    return fr('Bottom navigation', 24, 764, 342, 56, card, children, { cornerRadius: 28 });
  };

  const miniStat = (name: string, x: number, value: string, label: string) =>
    fr(name, x, 516, 106, 96, card, [
      t(`${name} value`, 12, 14, 82, 28, value, 20, '600', white),
      t(`${name} label`, 12, 50, 82, 14, label, 9, '500', muted),
      e(`${name} dot`, 12, 72, 6, 6, lime),
    ], { cornerRadius: 16 });

  return doc([
    fr('Home screen', 0, 0, 390, 844, bg, [
      ...statusBar(),
      t('Date', 24, 82, 220, 16, 'MONDAY, 21 OCTOBER', 9, '600', muted, { letterSpacing: 1.2 }),
      e('Avatar', 326, 72, 40, 40, '#26303C'),
      t('Avatar letter', 326, 82, 40, 20, 'A', 13, '600', lime, { align: 'center' }),
      t('Greeting title', 24, 106, 300, 82, 'Good morning,\nAda', 30, '600', white, {
        lineHeight: 1.14,
        letterSpacing: -0.8,
      }),

      fr('Sleep score card', 24, 214, 342, 236, card, [
        e('Score ring track', 26, 32, 148, 148, null, { stroke: hair, strokeWidth: 12 }),
        e('Score ring accent', 26, 32, 148, 148, null, { stroke: lime, strokeWidth: 3 }),
        t('Score number', 26, 76, 148, 48, '86', 40, '600', white, { align: 'center' }),
        t('Score label', 26, 126, 148, 14, 'SLEEP SCORE', 8, '600', muted, {
          align: 'center',
          letterSpacing: 1.3,
        }),
        line('Score divider', 196, 32, 1, 148, hair),
        t('Sleep duration', 216, 38, 100, 30, '7h 42m', 23, '600', white),
        t('Sleep duration label', 216, 70, 100, 14, 'Time asleep', 9, '500', muted),
        line('Sleep divider', 216, 98, 100, 1, hair),
        t('Restorative', 216, 112, 100, 26, '92%', 20, '600', lime),
        t('Restorative label', 216, 140, 100, 14, 'Restorative', 9, '500', muted),
      ], { cornerRadius: 26 }),

      t('Last night title', 24, 486, 200, 20, 'Last night', 16, '600', white),
      t('Last night action', 274, 488, 92, 16, 'See all  →', 10, '500', lime, { align: 'right' }),
      miniStat('Readiness', 24, '82', 'Readiness'),
      miniStat('Heart rate', 142, '58', 'Resting HR'),
      miniStat('HRV', 260, '64', 'HRV · ms'),

      fr('Tonight plan', 24, 640, 342, 110, lime, [
        t('Plan label', 20, 16, 220, 14, 'TONIGHT’S PLAN', 8, '600', '#5A6420', {
          letterSpacing: 1.3,
        }),
        t('Plan title', 20, 36, 260, 24, 'Wind down at 10:30 PM', 17, '600', '#1B210C'),
        r('Plan button', 20, 68, 136, 30, '#1B210C', 15),
        t('Plan button label', 20, 75, 136, 16, 'Start routine', 10, '600', lime, { align: 'center' }),
        e('Plan moon', 286, 30, 36, 36, '#C3DD57'),
      ], { cornerRadius: 22 }),
      nav(0),
    ]),

    fr('Insights screen', 440, 0, 390, 844, bg, [
      ...statusBar(),
      t('Insights title', 24, 78, 220, 40, 'Insights', 30, '600', white, { letterSpacing: -0.8 }),
      r('Period pill', 270, 84, 96, 32, card, 16),
      t('Period label', 270, 93, 96, 16, 'This week', 10, '500', lime, { align: 'center' }),

      fr('Sleep chart card', 24, 150, 342, 260, card, [
        t('Chart title', 20, 20, 160, 16, 'Sleep duration', 10, '500', muted),
        t('Chart value', 20, 42, 180, 28, '7h 38m', 22, '600', white),
        t('Chart delta', 20, 72, 160, 14, '+18 min vs last week', 9, '500', lime),
        line('Grid 1', 20, 108, 302, 1, hair),
        line('Grid 2', 20, 148, 302, 1, hair),
        line('Grid 3', 20, 188, 302, 1, hair),
        r('Bar mon', 32, 194, 20, 24, '#2C3742', 6),
        r('Bar tue', 74, 164, 20, 54, '#2C3742', 6),
        r('Bar wed', 116, 178, 20, 40, '#2C3742', 6),
        r('Bar thu', 158, 140, 20, 78, '#2C3742', 6),
        r('Bar fri', 200, 152, 20, 66, '#2C3742', 6),
        r('Bar sat', 242, 108, 20, 110, lime, 6),
        r('Bar sun', 284, 132, 20, 86, '#2C3742', 6),
        t('Day mon', 32, 224, 20, 12, 'M', 8, '500', muted, { align: 'center' }),
        t('Day tue', 74, 224, 20, 12, 'T', 8, '500', muted, { align: 'center' }),
        t('Day wed', 116, 224, 20, 12, 'W', 8, '500', muted, { align: 'center' }),
        t('Day thu', 158, 224, 20, 12, 'T', 8, '500', muted, { align: 'center' }),
        t('Day fri', 200, 224, 20, 12, 'F', 8, '500', muted, { align: 'center' }),
        t('Day sat', 242, 224, 20, 12, 'S', 8, '600', lime, { align: 'center' }),
        t('Day sun', 284, 224, 20, 12, 'S', 8, '500', muted, { align: 'center' }),
      ], { cornerRadius: 24 }),

      fr('Consistency card', 24, 436, 164, 104, card, [
        t('Consistency value', 14, 14, 110, 28, '91%', 20, '600', lime),
        t('Consistency label', 14, 48, 110, 16, 'Consistency', 9, '500', muted),
        r('Consistency track', 14, 76, 136, 5, hair, 3),
        r('Consistency fill', 14, 76, 124, 5, lime, 3),
      ], { cornerRadius: 18 }),
      fr('Resting card', 190, 436, 176, 104, card, [
        t('Resting value', 14, 14, 110, 28, '58 bpm', 20, '600', white),
        t('Resting label', 14, 48, 120, 16, 'Resting heart rate', 9, '500', muted),
        t('Resting delta', 14, 74, 120, 14, '−3 bpm this month', 8, '500', '#9AA5B1'),
      ], { cornerRadius: 18 }),

      fr('Breakdown card', 24, 562, 342, 150, card, [
        t('Breakdown title', 18, 16, 200, 16, 'Your week, explained', 10, '600', white),
        e('Row 1 dot', 18, 48, 8, 8, lime),
        t('Row 1 label', 34, 44, 160, 16, 'Deep sleep', 11, '500', '#B7C0CA'),
        t('Row 1 value', 250, 44, 72, 16, '1h 48m', 11, '600', white, { align: 'right' }),
        e('Row 2 dot', 18, 78, 8, 8, '#7FA5D8'),
        t('Row 2 label', 34, 74, 160, 16, 'REM sleep', 11, '500', '#B7C0CA'),
        t('Row 2 value', 250, 74, 72, 16, '1h 32m', 11, '600', white, { align: 'right' }),
        e('Row 3 dot', 18, 108, 8, 8, '#C7A7E0'),
        t('Row 3 label', 34, 104, 160, 16, 'Bedtime variance', 11, '500', '#B7C0CA'),
        t('Row 3 value', 250, 104, 72, 16, '± 14 min', 11, '600', white, { align: 'right' }),
      ], { cornerRadius: 20 }),
      nav(1),
    ]),

    fr('Profile screen', 880, 0, 390, 844, bg, [
      ...statusBar(),
      t('Profile title', 24, 78, 220, 40, 'Profile', 30, '600', white, { letterSpacing: -0.8 }),
      e('Profile avatar', 155, 136, 80, 80, lime),
      t('Profile initials', 155, 162, 80, 30, 'AP', 22, '600', '#1B210C', { align: 'center' }),
      t('Profile name', 95, 232, 200, 26, 'Ada Putri', 20, '600', white, { align: 'center' }),
      t('Profile email', 95, 260, 200, 16, 'ada@luma.app', 10, '400', muted, { align: 'center' }),

      fr('Plan card', 24, 302, 342, 128, '#1B2110', [
        t('Plan eyebrow', 18, 16, 200, 14, 'LUMA PLUS', 8, '600', lime, { letterSpacing: 1.3 }),
        t('Plan title', 18, 36, 220, 26, 'Your plan renews 12 Nov', 15, '600', white),
        t('Plan copy', 18, 64, 220, 30, 'Unlimited insights and 12 months of history.', 9, '400', '#9AA5B1', {
          lineHeight: 1.4,
        }),
        r('Plan manage', 18, 94, 100, 26, lime, 13),
        t('Plan manage label', 18, 100, 100, 14, 'Manage', 9, '600', '#1B210C', { align: 'center' }),
      ], { cornerRadius: 22 }),

      fr('Stat sleep', 24, 454, 106, 82, card, [
        t('Stat sleep value', 12, 12, 80, 24, '86', 18, '600', lime),
        t('Stat sleep label', 12, 42, 80, 14, 'Avg score', 8, '500', muted),
      ], { cornerRadius: 16 }),
      fr('Stat nights', 142, 454, 106, 82, card, [
        t('Stat nights value', 12, 12, 80, 24, '28', 18, '600', white),
        t('Stat nights label', 12, 42, 80, 14, 'Nights logged', 8, '500', muted),
      ], { cornerRadius: 16 }),
      fr('Stat streak', 260, 454, 106, 82, card, [
        t('Stat streak value', 12, 12, 80, 24, '12', 18, '600', white),
        t('Stat streak label', 12, 42, 80, 14, 'Day streak', 8, '500', muted),
      ], { cornerRadius: 16 }),

      fr('Settings card', 24, 560, 342, 186, card, [
        t('Setting row 1', 18, 18, 200, 18, 'Sleep schedule', 11, '500', '#C7CFD7'),
        t('Setting row 1 value', 280, 18, 44, 18, '22:30', 10, '500', muted, { align: 'right' }),
        line('Setting sep 1', 18, 52, 306, 1, hair),
        t('Setting row 2', 18, 68, 200, 18, 'Smart alarm', 11, '500', '#C7CFD7'),
        t('Setting row 2 value', 280, 68, 44, 18, 'On', 10, '500', lime, { align: 'right' }),
        line('Setting sep 2', 18, 102, 306, 1, hair),
        t('Setting row 3', 18, 118, 200, 18, 'Notifications', 11, '500', '#C7CFD7'),
        t('Setting row 3 value', 280, 118, 44, 18, '›', 14, '500', muted, { align: 'right' }),
        line('Setting sep 3', 18, 152, 306, 1, hair),
        t('Setting row 4', 18, 162, 200, 16, 'Help & support', 11, '500', '#C7CFD7'),
      ], { cornerRadius: 20 }),
      t('Sign out', 24, 748, 100, 16, 'Sign out', 10, '500', '#7C8794'),
      nav(3),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

function dashboardDoc(): PenDocument {
  const bg = '#0B0D10';
  const sidebar = '#0D1116';
  const card = '#12161B';
  const border = '#1D232B';
  const white = '#E8ECF1';
  const muted = '#8A94A0';
  const faint = '#5C6672';
  const lime = '#C8F169';
  const blue = '#6EA8FE';
  const orange = '#FF8A5B';

  const navItem = (name: string, y: number, label: string, active = false) => {
    const children: PenNode[] = [
      r(`${name} icon`, 36, 11, 12, 12, active ? lime : faint, 3),
      t(`${name} label`, 58, 9, 150, 18, label, 12, active ? '600' : '500', active ? white : muted),
    ];
    if (active) children.unshift(r(`${name} bg`, 20, 0, 208, 36, '#1A2028', 9));
    return fr(name, 0, y, 248, 36, null, children);
  };

  const kpi = (
    name: string,
    x: number,
    label: string,
    value: string,
    delta: string,
    positive: boolean,
    bars: number[],
  ) =>
    fr(name, x, 112, 360, 128, card, [
      t(`${name} label`, 20, 20, 180, 16, label, 11, '500', muted),
      t(`${name} value`, 20, 42, 220, 36, value, 28, '600', white, { letterSpacing: -0.8 }),
      r(`${name} delta bg`, 20, 92, 68, 22, positive ? '#1B2A1A' : '#2A1D19', 11),
      t(`${name} delta`, 20, 96, 68, 14, delta, 9, '600', positive ? lime : orange, {
        align: 'center',
      }),
      ...bars.map((height, i) =>
        r(`${name} spark ${i + 1}`, 268 + i * 16, 100 - height, 8, height, positive ? '#33441F' : '#3A2A22', 3),
      ),
    ], { cornerRadius: 14, stroke: border, strokeWidth: 1 });

  const chartBars = [88, 112, 96, 140, 122, 164, 150, 188, 170, 206, 192, 228];
  const barNodes: PenNode[] = chartBars.map((height, i) =>
    r(
      `Revenue bar ${i + 1}`,
      42 + i * 54,
      280 - height,
      26,
      height,
      i === chartBars.length - 1 ? lime : i >= 9 ? '#5E7A35' : '#27301C',
      5,
    ),
  );

  const transactions = [
    { name: 'Acme Studio', mail: 'billing@acme.co', date: 'Oct 21, 2026', amount: '$4,200.00', status: 'Paid', color: lime },
    { name: 'Northwind', mail: 'finance@northwind.io', date: 'Oct 20, 2026', amount: '$2,850.00', status: 'Paid', color: lime },
    { name: 'Lumen Labs', mail: 'ops@lumen.dev', date: 'Oct 19, 2026', amount: '$1,240.00', status: 'Pending', color: '#F5C26B' },
    { name: 'Fieldwork', mail: 'hello@fieldwork.studio', date: 'Oct 18, 2026', amount: '$960.00', status: 'Paid', color: lime },
  ];

  const tableRows: PenNode[] = [];
  transactions.forEach((row, i) => {
    const y = 92 + i * 36;
    tableRows.push(
      line(`Row sep ${i + 1}`, 24, y - 4, 1072, 1, '#181D23'),
      e(`Avatar ${i + 1}`, 24, y + 5, 24, 24, '#20262E'),
      t(`Avatar letter ${i + 1}`, 24, y + 11, 24, 14, row.name.slice(0, 1), 9, '600', white, {
        align: 'center',
      }),
      t(`Customer ${i + 1}`, 60, y + 5, 200, 18, row.name, 11, '600', white),
      t(`Email ${i + 1}`, 60, y + 22, 200, 12, row.mail, 8, '400', faint),
      t(`Date ${i + 1}`, 620, y + 12, 120, 16, row.date, 10, '400', muted),
      t(`Amount ${i + 1}`, 800, y + 12, 100, 16, row.amount, 10, '600', white),
      r(`Status bg ${i + 1}`, 980, y + 7, 64, 22, row.status === 'Paid' ? '#1B2A1A' : '#2A2418', 11),
      t(`Status ${i + 1}`, 980, y + 11, 64, 14, row.status, 8, '600', row.color, { align: 'center' }),
    );
  });

  return doc([
    fr('Dashboard', 0, 0, 1440, 900, bg, [
      // sidebar
      fr('Sidebar', 0, 0, 248, 900, sidebar, [
        r('Logo tile', 28, 26, 34, 34, lime, 9),
        t('Logo glyph', 28, 33, 34, 22, 'a', 17, '700', '#10150A', { align: 'center' }),
        t('Wordmark', 74, 33, 130, 24, 'Atlas', 18, '700', white, { letterSpacing: -0.4 }),
        t('Workspace label', 28, 98, 160, 14, 'WORKSPACE', 8, '600', faint, { letterSpacing: 1.4 }),
        navItem('Nav overview', 120, 'Overview', true),
        navItem('Nav analytics', 160, 'Analytics'),
        navItem('Nav projects', 200, 'Projects'),
        navItem('Nav reports', 240, 'Reports'),
        t('Manage label', 28, 300, 160, 14, 'MANAGE', 8, '600', faint, { letterSpacing: 1.4 }),
        navItem('Nav team', 322, 'Team'),
        navItem('Nav billing', 362, 'Billing'),
        navItem('Nav settings', 402, 'Settings'),
        fr('Plan card', 20, 742, 208, 118, '#151B22', [
          t('Plan eyebrow', 16, 14, 160, 12, 'PRO PLAN', 8, '600', lime, { letterSpacing: 1.2 }),
          t('Plan title', 16, 32, 170, 20, '72% of seats used', 12, '600', white),
          r('Plan track', 16, 62, 176, 5, '#252D36', 3),
          r('Plan fill', 16, 62, 128, 5, lime, 3),
          r('Plan button', 16, 80, 176, 26, lime, 7),
          t('Plan button label', 16, 86, 176, 14, 'Manage seats', 9, '600', '#10150A', { align: 'center' }),
        ], { cornerRadius: 14 }),
        e('User avatar', 28, 860, 28, 28, '#2A3340'),
        t('User initials', 28, 866, 28, 16, 'KK', 8, '600', white, { align: 'center' }),
        t('User name', 66, 864, 100, 16, 'Kai Kramer', 9, '500', muted),
      ]),

      // top bar
      t('Page title', 280, 32, 400, 34, 'Overview', 24, '600', white, { letterSpacing: -0.6 }),
      t('Page subtitle', 280, 66, 420, 16, 'Monday, 21 October · All systems normal', 10, '400', muted),
      r('Search', 960, 34, 240, 36, '#10151A', 8, { stroke: border, strokeWidth: 1 }),
      t('Search placeholder', 976, 44, 150, 16, 'Search anything…', 10, '400', faint),
      r('Search key', 1158, 42, 28, 20, '#1A2028', 5),
      t('Search key label', 1158, 46, 28, 12, '⌘K', 7, '500', muted, { align: 'center' }),
      r('Bell', 1216, 34, 36, 36, '#10151A', 18, { stroke: border, strokeWidth: 1 }),
      e('Bell dot', 1238, 40, 7, 7, orange),
      t('Bell glyph', 1216, 42, 36, 18, '◔', 12, '500', muted, { align: 'center' }),
      r('Header avatar', 1268, 34, 36, 36, '#2A3340', 18),
      t('Header avatar initials', 1268, 42, 36, 18, 'KK', 10, '600', white, { align: 'center' }),
      r('New button', 1320, 34, 80, 36, lime, 8),
      t('New button label', 1320, 44, 80, 16, '+ New', 10, '600', '#10150A', { align: 'center' }),

      // KPIs
      kpi('KPI revenue', 280, 'MONTHLY REVENUE', '$128,430', '+12.4%', true, [10, 16, 12, 22, 18, 28]),
      kpi('KPI users', 660, 'ACTIVE USERS', '24,891', '+8.2%', true, [8, 12, 18, 14, 24, 26]),
      kpi('KPI churn', 1040, 'CHURN RATE', '1.9%', '−0.4%', true, [26, 22, 24, 16, 14, 10]),

      // revenue chart
      fr('Revenue card', 280, 266, 720, 336, card, [
        t('Revenue title', 24, 22, 220, 24, 'Revenue', 15, '600', white),
        t('Revenue subtitle', 24, 46, 260, 14, 'Recurring revenue over the last 12 weeks', 9, '400', muted),
        r('Range pill', 540, 22, 156, 30, '#181E25', 8),
        t('Range label', 540, 30, 156, 14, 'Last 12 weeks  ⌄', 9, '500', muted, { align: 'center' }),
        line('Grid top', 24, 110, 672, 1, '#191F26'),
        line('Grid mid', 24, 160, 672, 1, '#191F26'),
        line('Grid low', 24, 210, 672, 1, '#191F26'),
        line('Grid base', 24, 280, 672, 1, '#242B33'),
        t('Axis 40k', 24, 104, 40, 12, '40k', 7, '400', faint),
        t('Axis 20k', 24, 204, 40, 12, '20k', 7, '400', faint),
        ...barNodes,
        t('Week label 1', 36, 292, 40, 12, 'W1', 7, '400', faint),
        t('Week label 2', 414, 292, 40, 12, 'W7', 7, '400', faint),
        t('Week label 3', 630, 292, 60, 12, 'W12', 7, '600', lime),
      ], { cornerRadius: 16, stroke: border, strokeWidth: 1 }),

      // donut
      fr('Traffic card', 1024, 266, 376, 336, card, [
        t('Traffic title', 24, 22, 240, 24, 'Traffic by source', 15, '600', white),
        t('Traffic subtitle', 24, 46, 240, 14, 'Sessions this month', 9, '400', muted),
        e('Donut track', 88, 82, 196, 196, null, { stroke: '#202832', strokeWidth: 26 }),
        e('Donut accent', 88, 82, 196, 196, null, { stroke: lime, strokeWidth: 26 }),
        e('Donut hole', 120, 114, 132, 132, card),
        t('Donut value', 120, 158, 132, 40, '68%', 28, '600', white, { align: 'center', letterSpacing: -0.8 }),
        t('Donut label', 120, 198, 132, 16, 'Organic', 9, '500', muted, { align: 'center' }),
        e('Legend dot 1', 24, 294, 7, 7, lime),
        t('Legend 1', 38, 290, 110, 14, 'Organic', 9, '500', muted),
        t('Legend 1 value', 270, 290, 80, 14, '68%', 9, '600', white, { align: 'right' }),
        e('Legend dot 2', 24, 316, 7, 7, blue),
        t('Legend 2', 38, 312, 110, 14, 'Referral', 9, '500', muted),
        t('Legend 2 value', 270, 312, 80, 14, '21%', 9, '600', white, { align: 'right' }),
      ], { cornerRadius: 16, stroke: border, strokeWidth: 1 }),

      // table
      fr('Transactions card', 280, 626, 1120, 244, card, [
        t('Table title', 24, 20, 260, 24, 'Recent transactions', 15, '600', white),
        t('Table action', 972, 24, 124, 16, 'View all  →', 9, '600', lime, { align: 'right' }),
        t('Column customer', 24, 64, 240, 14, 'CUSTOMER', 8, '600', faint, { letterSpacing: 1 }),
        t('Column date', 620, 64, 120, 14, 'DATE', 8, '600', faint, { letterSpacing: 1 }),
        t('Column amount', 800, 64, 100, 14, 'AMOUNT', 8, '600', faint, { letterSpacing: 1 }),
        t('Column status', 980, 64, 100, 14, 'STATUS', 8, '600', faint, { letterSpacing: 1 }),
        ...tableRows,
      ], { cornerRadius: 16, stroke: border, strokeWidth: 1 }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Slides (three 16:9 artboards)                                      */
/* ------------------------------------------------------------------ */

function slidesDoc(): PenDocument {
  const dark = '#101014';
  const light = '#F1EEE5';
  const ink = '#16150F';
  const orange = '#FF5A1F';

  const footer = (frameName: string, fg: string) => [
    line(`${frameName} footer rule`, 100, 806, 1400, 1, fg === '#FFFFFF' ? '#2A2A30' : '#D8D3C6'),
    t(`${frameName} footer left`, 100, 828, 400, 16, 'Horizon Studio · Product strategy', 10, '500', fg === '#FFFFFF' ? '#8B8B96' : '#7A7468'),
  ];

  return doc([
    fr('Slide 1 · Cover', 0, 0, 1600, 900, dark, [
      e('Cover glow', 1060, -280, 820, 820, '#FF5A1F'),
      e('Cover glow inner', 1180, -140, 520, 520, '#FF7A45'),
      r('Cover logo tile', 100, 64, 34, 34, '#FFFFFF', 9),
      t('Cover logo glyph', 100, 71, 34, 22, 'h', 17, '700', dark, { align: 'center' }),
      t('Cover wordmark', 146, 70, 220, 22, 'HORIZON', 13, '700', '#FFFFFF', { letterSpacing: 2.4 }),
      t('Cover date', 1320, 70, 180, 20, 'OCTOBER 2026', 10, '500', '#8B8B96', {
        align: 'right',
        letterSpacing: 1.6,
      }),
      t('Cover eyebrow', 100, 206, 600, 20, 'PRODUCT STRATEGY · 2026', 11, '600', '#FFB59C', {
        letterSpacing: 2.2,
      }),
      t('Cover headline', 100, 252, 1060, 320, 'The next\ncanvas is yours.', 122, '600', '#FFFFFF', {
        lineHeight: 0.96,
        letterSpacing: -5.4,
      }),
      t(
        'Cover subtitle',
        100,
        614,
        600,
        60,
        'Why the best product teams are replacing static files with living design systems.',
        18,
        '400',
        '#B7B7C0',
        { lineHeight: 1.55 },
      ),
      r('Cover pill', 100, 710, 170, 44, '#FFFFFF', 22),
      t('Cover pill label', 100, 722, 170, 18, 'Read the brief  →', 11, '600', dark, { align: 'center' }),
      ...footer('Cover', '#FFFFFF'),
      t('Cover page', 1440, 828, 60, 16, '01 / 03', 10, '500', '#8B8B96', { align: 'right' }),
    ]),

    fr('Slide 2 · Ideas', 0, 960, 1600, 900, light, [
      r('Ideas logo tile', 100, 64, 34, 34, ink, 9),
      t('Ideas logo glyph', 100, 71, 34, 22, 'h', 17, '700', light, { align: 'center' }),
      t('Ideas wordmark', 146, 70, 220, 22, 'HORIZON', 13, '700', ink, { letterSpacing: 2.4 }),
      t('Ideas section', 100, 148, 500, 20, '01 — THE SHIFT', 10, '600', orange, { letterSpacing: 2 }),
      t('Ideas title', 100, 184, 1000, 86, 'Three ideas that compound.', 70, '600', ink, {
        letterSpacing: -2.6,
      }),
      t(
        'Ideas lead',
        100,
        274,
        620,
        48,
        'The teams shipping fastest are not designing more screens. They are designing better constraints.',
        15,
        '400',
        '#5B574C',
        { lineHeight: 1.55 },
      ),

      t('Idea 1 number', 100, 402, 120, 80, '01', 64, '600', orange, { letterSpacing: -2 }),
      t('Idea 1 title', 100, 500, 380, 64, 'Start with the system, not the screen.', 26, '600', ink, { lineHeight: 1.15 }),
      t(
        'Idea 1 body',
        100,
        576,
        380,
        90,
        'Tokens and primitives make thousands of decisions once. Screens become combinations, not one-offs.',
        14,
        '400',
        '#6A665B',
        { lineHeight: 1.6 },
      ),
      line('Idea 1 rule', 100, 700, 380, 1, '#D5D0C2'),

      t('Idea 2 number', 560, 402, 120, 80, '02', 64, '600', '#B4AE9E', { letterSpacing: -2 }),
      t('Idea 2 title', 560, 500, 380, 64, 'Make the default the good decision.', 26, '600', ink, { lineHeight: 1.15 }),
      t(
        'Idea 2 body',
        560,
        576,
        380,
        90,
        'A component that is accessible, responsive and on-brand by default removes a hundred future mistakes.',
        14,
        '400',
        '#6A665B',
        { lineHeight: 1.6 },
      ),
      line('Idea 2 rule', 560, 700, 380, 1, '#D5D0C2'),

      t('Idea 3 number', 1020, 402, 120, 80, '03', 64, '600', '#B4AE9E', { letterSpacing: -2 }),
      t('Idea 3 title', 1020, 500, 380, 64, 'Ship the decision, not the artifact.', 26, '600', ink, { lineHeight: 1.15 }),
      t(
        'Idea 3 body',
        1020,
        576,
        380,
        90,
        'A living artifact carries intent into code. The file is a means; the shared decision is the product.',
        14,
        '400',
        '#6A665B',
        { lineHeight: 1.6 },
      ),
      line('Idea 3 rule', 1020, 700, 380, 1, '#D5D0C2'),

      ...footer('Ideas', '#16150F'),
      t('Ideas page', 1440, 828, 60, 16, '02 / 03', 10, '500', '#7A7468', { align: 'right' }),
    ]),

    fr('Slide 3 · Quote', 0, 1920, 1600, 900, orange, [
      t('Quote mark', 100, 90, 300, 260, '“', 240, '600', '#FFD8C9', { lineHeight: 0.8 }),
      t('Quote eyebrow', 160, 260, 500, 20, 'IN CLOSING', 10, '600', '#5C1F0A', { letterSpacing: 2.2 }),
      t(
        'Quote text',
        160,
        304,
        1240,
        300,
        'The best interface is the one that gets out of the way.',
        78,
        '600',
        '#FFFFFF',
        { lineHeight: 1.04, letterSpacing: -2.4 },
      ),
      line('Quote rule', 160, 650, 120, 3, '#FFFFFF'),
      t('Quote author', 160, 682, 500, 24, 'Mira Chen', 16, '600', '#FFFFFF'),
      t('Quote role', 160, 710, 500, 20, 'VP Design, Horizon Studio', 12, '400', '#5C1F0A'),
      r('Quote logo tile', 1360, 64, 40, 40, '#FFFFFF', 10),
      t('Quote logo glyph', 1360, 72, 40, 24, 'h', 19, '700', orange, { align: 'center' }),
      ...footer('Quote', '#FFFFFF').map((node) => {
        if (node.type === 'text' && node.name === 'Quote footer left') {
          return { ...node, fill: '#5C1F0A' };
        }
        if (node.type === 'rectangle') return { ...node, fill: '#FFFFFF' };
        return node;
      }),
      t('Quote page', 1440, 828, 60, 16, '03 / 03', 10, '500', '#5C1F0A', { align: 'right' }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Design system                                                      */
/* ------------------------------------------------------------------ */

function designSystemDoc(): PenDocument {
  const bg = '#F6F5F1';
  const ink = '#16150F';
  const muted = '#6E6A5F';
  const faint = '#9C978A';
  const orange = '#FF5A1F';
  const hair = '#DDD8CB';
  const card = '#FFFFFF';

  const swatches = [
    { name: 'Ink', hex: '#16150F', color: ink },
    { name: 'Ember', hex: '#FF5A1F', color: orange },
    { name: 'Paper', hex: '#F6F5F1', color: bg },
    { name: 'Sage', hex: '#A8B59A', color: '#A8B59A' },
    { name: 'Cobalt', hex: '#6C8CF5', color: '#6C8CF5' },
    { name: 'Sand', hex: '#D8CFC0', color: '#D8CFC0' },
    { name: 'Lilac', hex: '#C9BCE8', color: '#C9BCE8' },
    { name: 'White', hex: '#FFFFFF', color: '#FFFFFF' },
  ];

  const swatchNodes: PenNode[] = [];
  swatches.forEach((sw, i) => {
    const x = 64 + i * 136;
    swatchNodes.push(
      r(`Swatch ${sw.name}`, x, 310, 120, 72, sw.color, 12, {
        stroke: sw.hex === '#FFFFFF' || sw.hex === bg ? hair : undefined,
        strokeWidth: 1,
      }),
      t(`Swatch name ${sw.name}`, x, 394, 100, 16, sw.name, 11, '600', ink),
      t(`Swatch hex ${sw.name}`, x, 412, 110, 14, sw.hex, 9, '400', faint),
    );
  });

  return doc([
    fr('Design system', 0, 0, 1200, 900, bg, [
      // header
      r('Logo tile', 64, 54, 36, 36, ink, 10),
      t('Logo glyph', 64, 61, 36, 22, 'f', 17, '700', bg, { align: 'center' }),
      t('Wordmark', 112, 60, 240, 24, 'Foundations', 16, '600', ink, { letterSpacing: -0.3 }),
      r('Version pill', 1052, 58, 84, 28, '#EBE8DF', 14),
      t('Version label', 1052, 65, 84, 14, 'v2.21', 10, '600', muted, { align: 'center' }),
      t('Page title', 64, 112, 700, 52, 'Foundations', 44, '600', ink, { letterSpacing: -1.8 }),
      t(
        'Page subtitle',
        64,
        168,
        640,
        42,
        'The shared language behind every screen: color, type, components and the space between them.',
        14,
        '400',
        muted,
        { lineHeight: 1.55 },
      ),
      line('Header rule', 64, 224, 1072, 1, hair),

      // color
      t('Color section', 64, 248, 300, 14, '01 · COLOR', 9, '700', orange, { letterSpacing: 1.6 }),
      t('Color heading', 64, 268, 300, 26, 'Core palette', 20, '600', ink),
      t('Color note', 880, 274, 256, 16, '8 tokens · WCAG AA pairs', 9, '400', faint, {
        align: 'right',
      }),
      ...swatchNodes,

      // typography
      t('Type section', 64, 464, 300, 14, '02 · TYPE', 9, '700', orange, { letterSpacing: 1.6 }),
      t('Type heading', 64, 484, 300, 26, 'Inter', 20, '600', ink),
      t('Type glyph', 64, 516, 150, 132, 'Aa', 108, '600', ink, { letterSpacing: -4 }),
      t('Type family', 64, 660, 200, 18, 'Inter / Variable', 11, '600', ink),
      t('Type weights', 64, 682, 220, 16, '400 · 500 · 600 · 700', 9, '400', faint),
      t('Type usage', 64, 710, 220, 50, 'UI text, headings and labels. No external font requests.', 9, '400', muted, {
        lineHeight: 1.5,
      }),

      line('Type rule', 246, 516, 1, 250, hair),
      t('Scale display meta', 270, 516, 240, 14, 'DISPLAY · 56 / 1.04', 8, '600', faint, {
        letterSpacing: 1,
      }),
      t('Scale display', 270, 534, 280, 64, 'Make it real.', 52, '600', ink, { letterSpacing: -1.8 }),
      line('Scale rule 1', 270, 606, 240, 1, hair),
      t('Scale heading meta', 270, 620, 240, 14, 'HEADING · 32 / 1.15', 8, '600', faint, {
        letterSpacing: 1,
      }),
      t('Scale heading', 270, 638, 280, 40, 'Design at speed', 30, '600', ink, { letterSpacing: -0.8 }),
      line('Scale rule 2', 270, 688, 240, 1, hair),
      t('Scale body meta', 270, 702, 240, 14, 'BODY · 16 / 1.55', 8, '600', faint, { letterSpacing: 1 }),
      t(
        'Scale body',
        270,
        720,
        260,
        52,
        'A calm reading rhythm with generous line height and real content.',
        14,
        '400',
        muted,
        { lineHeight: 1.55 },
      ),
      t('Scale label meta', 270, 786, 240, 14, 'LABEL · 12 · +1.4', 8, '600', faint, {
        letterSpacing: 1,
      }),
      t('Scale label', 270, 804, 240, 16, 'SECTION LABEL', 10, '700', ink, { letterSpacing: 1.6 }),

      // components
      t('Components section', 560, 464, 300, 14, '03 · COMPONENTS', 9, '700', orange, {
        letterSpacing: 1.6,
      }),
      t('Components heading', 560, 484, 300, 26, 'Buttons & inputs', 20, '600', ink),
      r('Primary button', 560, 524, 146, 42, orange, 10),
      t('Primary button label', 560, 536, 146, 18, 'Create file', 11, '600', '#FFFFFF', {
        align: 'center',
      }),
      r('Secondary button', 720, 524, 136, 42, card, 10, { stroke: hair, strokeWidth: 1 }),
      t('Secondary button label', 720, 536, 136, 18, 'Preview', 11, '600', ink, {
        align: 'center',
      }),
      t('Input label', 560, 590, 200, 14, 'Email address', 9, '600', muted),
      r('Input field', 560, 610, 296, 42, card, 10, { stroke: hair, strokeWidth: 1 }),
      t('Input placeholder', 574, 622, 250, 18, 'you@studio.com', 11, '400', faint),
      t('Input label focus', 560, 670, 200, 14, 'Project name', 9, '600', muted),
      r('Input field focus', 560, 690, 296, 42, card, 10, { stroke: orange, strokeWidth: 2 }),
      t('Input value focus', 574, 702, 250, 18, 'New project', 11, '500', ink),
      r('Chip 1', 560, 754, 78, 30, '#EDE9DF', 15),
      t('Chip 1 label', 560, 762, 78, 16, 'Design', 9, '500', muted, { align: 'center' }),
      r('Chip 2', 648, 754, 86, 30, '#FFE6DC', 15),
      t('Chip 2 label', 648, 762, 86, 16, 'Selected', 9, '600', orange, { align: 'center' }),
      r('Chip 3', 744, 754, 74, 30, '#EDE9DF', 15),
      t('Chip 3 label', 744, 762, 74, 16, 'Draft', 9, '500', muted, { align: 'center' }),

      // space and shape
      line('Column divider', 888, 464, 1, 370, hair),
      t('Space section', 916, 464, 220, 14, '04 · SPACE & SHAPE', 9, '700', orange, {
        letterSpacing: 1.6,
      }),
      t('Space heading', 916, 484, 220, 26, 'Rhythm', 20, '600', ink),
      t('Space 8 label', 916, 528, 30, 14, '8', 9, '500', faint),
      r('Space 8 bar', 946, 528, 8, 8, orange, 2),
      t('Space 16 label', 916, 550, 30, 14, '16', 9, '500', faint),
      r('Space 16 bar', 946, 550, 16, 8, orange, 2),
      t('Space 24 label', 916, 572, 30, 14, '24', 9, '500', faint),
      r('Space 24 bar', 946, 572, 24, 8, orange, 2),
      t('Space 32 label', 916, 594, 30, 14, '32', 9, '500', faint),
      r('Space 32 bar', 946, 594, 32, 8, orange, 2),
      t('Space 48 label', 916, 616, 30, 14, '48', 9, '500', faint),
      r('Space 48 bar', 946, 616, 48, 8, orange, 2),

      r('Radius 4', 916, 662, 44, 44, card, 4, { stroke: hair, strokeWidth: 1 }),
      t('Radius 4 label', 916, 712, 44, 14, '4', 8, '500', faint, { align: 'center' }),
      r('Radius 8', 970, 662, 44, 44, card, 8, { stroke: hair, strokeWidth: 1 }),
      t('Radius 8 label', 970, 712, 44, 14, '8', 8, '500', faint, { align: 'center' }),
      r('Radius 14', 1024, 662, 44, 44, card, 14, { stroke: hair, strokeWidth: 1 }),
      t('Radius 14 label', 1024, 712, 44, 14, '14', 8, '500', faint, { align: 'center' }),
      r('Radius 24', 1078, 662, 44, 44, card, 22, { stroke: hair, strokeWidth: 1 }),
      t('Radius 24 label', 1078, 712, 44, 14, '24', 8, '500', faint, { align: 'center' }),

      line('Space rule', 916, 748, 220, 1, hair),
      t('Contrast label', 916, 766, 220, 14, 'CONTRAST', 8, '600', faint, { letterSpacing: 1.2 }),
      t('Contrast value', 916, 784, 220, 24, 'AA · 4.8 : 1', 15, '600', ink),
      t('Contrast note', 916, 812, 220, 30, 'Body text on paper', 9, '400', faint),

      t('Footer left', 64, 858, 500, 16, 'Foundations v2.21 · Last updated 21 Oct 2026', 9, '400', faint),
      t('Footer right', 876, 858, 260, 16, 'Maintained by Design Platform', 9, '400', faint, {
        align: 'right',
      }),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Registry + offline generation                                      */
/* ------------------------------------------------------------------ */

export const SAMPLES: Sample[] = [
  {
    id: 'welcome',
    name: 'Welcome',
    doc: welcomeDoc(),
    prompt: 'A warm editorial welcome screen that introduces an AI design tool.',
  },
  {
    id: 'landing',
    name: 'Landing page',
    doc: landingDoc(),
    prompt: 'A polished SaaS landing page with a hero, product preview and three features.',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    doc: mobileDoc(),
    prompt: 'A dark mobile sleep-tracking app with home, insights and profile screens.',
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    doc: dashboardDoc(),
    prompt: 'A dark analytics dashboard with revenue KPIs, a chart and recent transactions.',
  },
  {
    id: 'slides',
    name: 'Slides',
    doc: slidesDoc(),
    prompt: 'A three-slide product strategy deck with a bold cover and closing quote.',
  },
  {
    id: 'design-system',
    name: 'Design system',
    doc: designSystemDoc(),
    prompt: 'A design-system foundations page with palette, type scale and components.',
  },
];

export const WELCOME_DOC = SAMPLES[0].doc;

function cloneDoc(doc: PenDocument): PenDocument {
  return JSON.parse(JSON.stringify(doc)) as PenDocument;
}

function byId(id: string): Sample {
  return SAMPLES.find((sample) => sample.id === id) ?? SAMPLES[1];
}

function matches(text: string, words: string[]): boolean {
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  });
}

/**
 * Offline keyword router. English + Indonesian, so prompts like
 * "buat dashboard analitik" or "aplikasi mobile" land on the right template.
 */
export function generateFromPrompt(prompt: string): { doc: PenDocument; name: string } {
  const text = (prompt ?? '').toLowerCase();

  if (
    matches(text, [
      'design system',
      'design-system',
      'sistem desain',
      'components',
      'component',
      'komponen',
      'figma',
      'style guide',
      'styleguide',
    ])
  ) {
    const sample = byId('design-system');
    return { doc: cloneDoc(sample.doc), name: sample.name };
  }

  if (matches(text, ['slide', 'slides', 'deck', 'presentation', 'presentasi', 'pitch', 'keynote'])) {
    const sample = byId('slides');
    return { doc: cloneDoc(sample.doc), name: sample.name };
  }

  if (
    matches(text, [
      'dashboard',
      'admin',
      'analytics',
      'analitik',
      'dasbor',
      'chart',
      'charts',
      'grafik',
      'report',
      'laporan',
      'metrics',
    ])
  ) {
    const sample = byId('dashboard');
    return { doc: cloneDoc(sample.doc), name: sample.name };
  }

  if (
    matches(text, [
      'mobile',
      'app',
      'application',
      'apps',
      'aplikasi',
      'ios',
      'android',
      'phone',
      'ponsel',
      'hp',
      'tablet',
    ])
  ) {
    const sample = byId('mobile');
    return { doc: cloneDoc(sample.doc), name: sample.name };
  }

  if (
    matches(text, [
      'landing',
      'website',
      'site',
      'web',
      'situs',
      'halaman',
      'laman',
      'homepage',
      'marketing',
      'saas',
    ])
  ) {
    const sample = byId('landing');
    return { doc: cloneDoc(sample.doc), name: sample.name };
  }

  const sample = byId('landing');
  const trimmed = (prompt ?? '').replace(/\s+/g, ' ').trim();
  const derived = trimmed.slice(0, 40).trim();
  const name = derived ? derived.charAt(0).toUpperCase() + derived.slice(1) : 'Untitled design';
  return { doc: cloneDoc(sample.doc), name };
}
