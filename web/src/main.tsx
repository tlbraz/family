import { Component, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import { App } from './App';
import { installBackTrap } from './back';
import { registerServiceWorker } from './share';
import './styles.css';

installBackTrap();
registerServiceWorker();

/** A crash while drawing shows what went wrong (see index.html) instead of a blank screen. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const where = (info.componentStack ?? '').trim().split('\n').slice(0, 4).join('\n');
    setTimeout(() => (window as unknown as { showBootError?: (s: string) => void }).showBootError?.(`${error.name}: ${error.message}\n${where}`));
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
);
