/**
 * Minimal but faithful subset of the .pen document schema (v2.x).
 * Docs: pen-schema.md shipped with pen.dev.
 */

export type Color = string;
export type Theme = Record<string, string>;
export type SizingBehavior = string;

export interface PaintColor {
  type: 'color';
  color: Color;
  enabled?: boolean;
  opacity?: number;
}
export interface PaintGradient {
  type: 'gradient';
  gradientType?: 'linear' | 'radial' | 'angular';
  colors?: { color: Color; position: number }[];
  opacity?: number;
  enabled?: boolean;
}
export interface PaintImage {
  type: 'image';
  url?: string;
  mode?: 'cover' | 'contain' | 'stretch';
  opacity?: number;
  enabled?: boolean;
}
export interface PaintShader {
  type: 'shader';
  url: string;
  uniforms?: Record<string, unknown>;
  opacity?: number;
  enabled?: boolean;
}
export type Paint = Color | PaintColor | PaintGradient | PaintImage | PaintShader;

export interface StrokeProps {
  stroke?: Paint | Paint[];
  strokeWidth?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'bevel' | 'round';
  strokeAlignment?: 'inner' | 'center' | 'outer';
}

export interface EffectProps {
  effect?:
    | {
        type: 'shadow';
        shadowType?: 'inner' | 'outer';
        offset?: { x: number; y: number };
        blur?: number;
        color?: Color;
        enabled?: boolean;
      }
    | { type: 'blur'; radius?: number; enabled?: boolean }
    | { type: 'background_blur'; radius?: number; enabled?: boolean }
    | { type: 'shader'; url: string; enabled?: boolean };
}

export interface LayoutProps {
  layout?: 'none' | 'vertical' | 'horizontal';
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?: 'start' | 'center' | 'end' | 'space_between' | 'space_around';
  alignItems?: 'start' | 'center' | 'end';
  layoutPosition?: 'auto' | 'absolute';
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  letterSpacing?: number;
  fontStyle?: string;
  underline?: boolean;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  strikethrough?: boolean;
  href?: string;
}

export interface PenNode extends LayoutProps, StrokeProps, EffectProps, TextStyle {
  type: NodeType;
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | SizingBehavior;
  height?: number | SizingBehavior;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  enabled?: boolean;
  clip?: boolean;
  fill?: Paint | Paint[];
  cornerRadius?: number | [number, number, number, number];
  /** frame / group */
  children?: PenNode[];
  /** text / note / context / prompt */
  content?: string;
  textGrowth?: 'auto' | 'fixed-width' | 'fixed-width-height';
  /** ellipse */
  innerRadius?: number;
  startAngle?: number;
  sweepAngle?: number;
  /** polygon */
  polygonCount?: number;
  /** path */
  geometry?: string;
  viewBox?: [number, number, number, number];
  fillRule?: 'nonzero' | 'evenodd';
  /** icon */
  library?: string;
  icon?: string;
  weight?: number;
  /** ref */
  ref?: string;
  descendants?: Record<string, Partial<PenNode>>;
  /** opaque passthrough */
  [key: string]: unknown;
}

export type NodeType =
  | 'frame'
  | 'group'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'path'
  | 'text'
  | 'note'
  | 'prompt'
  | 'context'
  | 'icon'
  | 'ref';

export interface PenDocument {
  version: string;
  children: PenNode[];
  themes?: Record<string, string[]>;
  imports?: Record<string, string>;
  variables?: Record<string, unknown>;
}

export type Tool =
  | 'select'
  | 'hand'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'path'
  | 'text'
  | 'icon'
  | 'comment';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EditorMode = 'dashboard' | 'editor';

export interface RecentFile {
  id: string;
  name: string;
  path?: string;
  updatedAt: number;
  doc?: PenDocument;
  thumbnail?: string;
}
