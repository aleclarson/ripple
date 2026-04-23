import type { BunPlugin } from 'bun';

export interface RippleBunPluginOptions {
	include?: RegExp;
	exclude?: RegExp | RegExp[];
	mode?: 'auto' | 'client' | 'server';
	dev?: boolean;
	hmr?: boolean;
	emitCss?: boolean;
	minifyCss?: boolean;
	compatKinds?: string[];
}

export function ripple(options?: RippleBunPluginOptions): BunPlugin;
export default ripple;
