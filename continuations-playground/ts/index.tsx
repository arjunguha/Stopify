import * as React from 'react';
import * as ReactDOM from 'react-dom';
import MonacoEditor from 'react-monaco-editor';
import { Hook, Console, Decode } from 'console-feed';
import { compile } from '@stopify/continuations';

// This code has a bug. Run the following variation with developer tools open:
//
// let x = {};
// debugger;
// console.log(x);
// x.stuff = 1234;
//
// If you step through execution, you'll see that the calll to appendLog is
// queued to run on the next turn, which is after the update to x.stuff occurs.
//
// The solution is to either:
//
// 1. Force the console.log to occur immediately (I don't know how to do that)
//    or,
// 2. Append to the log a deep copy of x, which is a pain to do.
function appendLog(method: 'log' | 'error', msg: any) {
    return function(prevState: { logs: any[] }) {
        return {
            logs: [...prevState.logs, {
                method: method,
                data: [msg]
            }]
        };
    };
}

type CodeLoaderState =
  { kind: 'loading' } |
  { kind: 'ok', code: string } |
  { kind: 'error', message: string };

class CodeLoader extends React.Component<{}, CodeLoaderState> {

    constructor(props: {}) {
        super(props);
        // Try to fetch code from the URL after the #
        if (window.location.hash !== '') {
            this.state = { kind: 'loading' };
            let url = window.location.hash.substring(1);
            fetch(url)
            .then(resp => resp.text())
            .then(code => this.setState({ kind: 'ok', code: code }))
            .catch(reason =>
                this.setState({ kind: 'error', message: String(reason) }));
        }
        else {
            this.state = {
                kind: 'ok',
                code: window.localStorage.getItem('code') || ''
            };
        }
    }

    render() {
        switch (this.state.kind) {
        case 'loading':
            return <div>Loading...</div>;
        case 'error':
            return <div>
                <p>Error loading code</p>
                <p>{this.state.message}</p>
            </div>;
        case 'ok':
            return <ContinuationsPlayground initialCode={this.state.code} />;
        }
    }
}

class ContinuationsPlayground extends React.Component<{ initialCode: string }, { logs: any[], code: string }> {

    constructor(props: { initialCode: string }) {
        super(props);
        this.state = {
            logs: [],
            code: props.initialCode
        };
    }

    reportError(message: any) {
        this.setState(appendLog('error', String(message).replace('$rts.g.','')));
    }

    onRun() {
        const compiledResult = compile(this.state.code);
        if (compiledResult.kind === 'error') {
            this.reportError(compiledResult.message);
            return;
        }
        window.localStorage.setItem('code', this.state.code);
        const runner = compiledResult.value;
        let globals = {
            setTimeout: (f: () => void, timeout: number) => {
                window.setTimeout(() => {
                    runner.processEvent(f, result => {
                        if (result.type === 'exception') {
                            this.reportError(result.value.toString());
                        }
                    });
                }, timeout);
            },
            Array: {
                from: function(iterable: any) {
                    return Array.from(iterable);
                }
            },
            console: {
                log: (msg: any) => this.setState(appendLog('log', msg))
            },
            shift: function(f: any) {
                return runner.shift(f);
            },
            reset: function(f: any) {
                return runner.reset(f);
            }
        };
        runner.g = globals;
        this.setState({ logs: [] });
        runner.run(result => {
            if (result.type === 'exception') {
                this.reportError(result.value.toString());
            }
        });
    }

    render() {
        return (
            <div style={{ display: 'grid', height: '100vh', width: '100vw',
                          gridTemplateColumns: '1fr 1fr',
                          gridColumnGap: '2px' }}>
                <div style={{gridRowStart: 1, gridColumnStart: 1}}>
                    <button onClick={() => this.onRun()}>
                        Run
                    </button>
                </div>
                <div style={{ gridColumnStart: 1, gridColumnEnd: 1, gridRowStart: 2 }}>
                    <MonacoEditor
                        onChange = { (newValue) => this.setState({ code: newValue }) }
                        language="javascript"
                        theme="vs-dark"
                        value={this.state.code}
                        options={ { automaticLayout: true } }
                        >
                    </MonacoEditor>
                </div>
            <div style={{ gridColumnStart: 2, gridColumnEnd: 2, gridRowStart: 2 }}>
                <div style={{height: "100%", backgroundColor: '#242424' }}>
                <Console variant="dark" logs={this.state.logs}/>
                </div>
            </div>
        </div>);
    }

}
ReactDOM.render(
    <CodeLoader />,
    document.querySelector('#root')
);
