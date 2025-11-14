import React, { useEffect, useRef, useState } from 'react';

type SignaturePadProps = {
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type Stroke = { points: { x: number; y: number }[] };

const WIDTH = 560;
const HEIGHT = 160;

export default function SignaturePad({ value, onChange, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef(false);

  useEffect(() => {
    const parsed = parseSignature(value);
    if (parsed) {
      setStrokes(parsed.strokes);
      redraw(parsed.strokes);
    } else if (!value) {
      setStrokes([]);
      clearCanvas();
    }
  }, [value]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    drawing.current = true;
    const { offsetX, offsetY } = event.nativeEvent;
    const nextStroke: Stroke = { points: [{ x: offsetX, y: offsetY }] };
    const nextStrokes = [...strokes, nextStroke];
    setStrokes(nextStrokes);
    redraw(nextStrokes);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const { offsetX, offsetY } = event.nativeEvent;
    setStrokes((prev) => {
      const next = [...prev];
      const current = next[next.length - 1];
      current.points = [...current.points, { x: offsetX, y: offsetY }];
      redraw(next);
      return next;
    });
  }

  function handlePointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    const payload = JSON.stringify({ width: WIDTH, height: HEIGHT, strokes });
    onChange(payload);
  }

  function handleClear() {
    setStrokes([]);
    clearCanvas();
    onChange('');
  }

  function redraw(targetStrokes: Stroke[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.lineCap = 'round';
    targetStrokes.forEach((stroke) => {
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
    });
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
  }

  return (
    <div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-3'>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className='w-full cursor-crosshair rounded-xl bg-white'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className='mt-2 flex items-center justify-between text-xs text-slate-500'>
        <span>Sign inside the box</span>
        <button
          type='button'
          onClick={handleClear}
          className='rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100'
          disabled={disabled}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function parseSignature(raw?: string | null) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.strokes)) {
      return parsed as { width: number; height: number; strokes: Stroke[] };
    }
  } catch {
    return null;
  }
  return null;
}
