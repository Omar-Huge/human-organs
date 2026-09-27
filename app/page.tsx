import ExplorerApp from '@/app/components/ExplorerApp.tsx';

/**
 * Server component. The shell below is a client island — the viewer needs the DOM and
 * a WebGL context, neither of which exists during server rendering.
 */
export default function Home() {
  return <ExplorerApp />;
}
