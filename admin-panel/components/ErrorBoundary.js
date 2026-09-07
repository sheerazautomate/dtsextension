'use client';

import { Component } from 'react';

/**
 * Error boundary for the admin panel.
 * Catches rendering errors in child components and shows a fallback UI
 * instead of white-screening the entire app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="shell">
          <div
            className="section"
            style={{
              border: '1px solid var(--critical)',
              borderRadius: 'var(--radius)',
              padding: '24px',
              marginTop: '40px'
            }}
          >
            <h2 style={{ color: 'var(--critical)', margin: '0 0 12px', fontSize: '16px' }}>
              Something went wrong
            </h2>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 16px', fontSize: '13px' }}>
              The admin panel encountered an error. Try refreshing the page.
            </p>
            <details style={{ color: 'var(--text-faint)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Error details</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.error?.message || String(this.state.error)}
              </pre>
            </details>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                marginTop: '16px',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '8px 16px',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '13px'
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
