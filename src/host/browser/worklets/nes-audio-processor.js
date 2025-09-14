// Bundled wrapper for the TypeScript worklet. Vite will rewrite this import to the built asset.
// We re-export the processor registration so AudioWorklet can load a JS module with the right MIME type.
import './nes-audio-processor.ts';

