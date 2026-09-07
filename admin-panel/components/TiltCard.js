'use client';

import { useRef } from 'react';
import anime from 'animejs';

// Kept deliberately understated — this sits in a monitoring tool that's
// meant to be glanced at, not a marketing page. Small angles, quick but
// smooth easing, no bounce/elastic overshoot.
const MAX_TILT_DEG = 5;
const FOLLOW_DURATION = 220;
const RETURN_DURATION = 450;

export default function TiltCard({ className = '', children, ...rest }) {
  const elRef = useRef(null);
  const state = useRef({ rx: 0, ry: 0, gx: 50, gy: 50 });
  const activeAnim = useRef(null);

  function apply() {
    const el = elRef.current;
    if (!el) return;
    const { rx, ry, gx, gy } = state.current;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    el.style.setProperty('--glare-x', `${gx}%`);
    el.style.setProperty('--glare-y', `${gy}%`);
  }

  function handleMove(e) {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    if (activeAnim.current) activeAnim.current.pause();
    activeAnim.current = anime({
      targets: state.current,
      rx: (0.5 - py) * 2 * MAX_TILT_DEG,
      ry: (px - 0.5) * 2 * MAX_TILT_DEG,
      gx: px * 100,
      gy: py * 100,
      duration: FOLLOW_DURATION,
      easing: 'easeOutQuad',
      update: apply
    });
  }

  function handleLeave() {
    if (activeAnim.current) activeAnim.current.pause();
    activeAnim.current = anime({
      targets: state.current,
      rx: 0,
      ry: 0,
      gx: 50,
      gy: 50,
      duration: RETURN_DURATION,
      easing: 'easeOutCubic',
      update: apply
    });
  }

  return (
    <div
      ref={elRef}
      className={`tilt-card ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...rest}
    >
      <div className="tilt-glare" aria-hidden="true" />
      {children}
    </div>
  );
}
