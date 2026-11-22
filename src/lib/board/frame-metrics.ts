/**
 * Frame geometry shared by the layout engine (graph.ts) and the rendered
 * frame (ChainFrame.svelte). Keep the header out of those two files so ELK
 * node bounds and the DOM cannot drift apart.
 */
export const FRAME_HEADER_HEIGHT = 30;
