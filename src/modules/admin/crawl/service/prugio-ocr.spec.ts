import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { runPrugioNameOcr } from './prugio-portraits';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

function processStub() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  jest
    .mocked(spawn)
    .mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

describe('Prugio name OCR process', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('keeps process diagnostics bounded on a nonzero exit', async () => {
    const child = processStub();
    const result = runPrugioNameOcr(Buffer.from('image'));
    child.stderr.write(`failure ${'x'.repeat(10_000)}`);
    child.emit('close', 2);
    await expect(result).rejects.toThrow(/종료 코드 2: failure/);
    await expect(result).rejects.toThrow(/^.{0,330}$/);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('reports timeout explicitly and kills the OCR child', async () => {
    jest.useFakeTimers();
    const child = processStub();
    const result = runPrugioNameOcr(Buffer.from('image'));
    const rejection = expect(result).rejects.toThrow('제한 시간(5초)');
    await jest.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
