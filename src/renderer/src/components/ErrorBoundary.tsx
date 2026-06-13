import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="modal-backdrop">
          <div className="modal" style={{ width: 520 }}>
            <h2>Something went wrong</h2>
            <p>{this.state.error.message}</p>
            <details style={{ maxHeight: 160, overflow: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Stack trace</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.error.stack ?? '(no stack)'}
              </pre>
            </details>
            <div className="modal-actions">
              <button className="btn primary" onClick={this.handleReload}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
