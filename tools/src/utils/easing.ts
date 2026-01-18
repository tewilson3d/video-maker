// Easing functions for keyframe interpolation
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export const easingFunctions = {
  linear: (t: number): number => t,
  'ease-in': (t: number): number => t * t,
  'ease-out': (t: number): number => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t: number): number => {
    if (t < 0.5) {
      return 2 * t * t;
    } else {
      return 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
  }
};

export const applyEasing = (t: number, easing: EasingType = 'linear'): number => {
  return easingFunctions[easing](t);
};

// Interpolate between two values using easing
export const interpolateWithEasing = (
  prevValue: any,
  nextValue: any,
  t: number,
  easing: EasingType = 'linear'
): any => {
  const easedT = applyEasing(t, easing);
  
  if (Array.isArray(prevValue) && Array.isArray(nextValue)) {
    return prevValue.map((v, i) => v + (nextValue[i] - v) * easedT);
  } else if (typeof prevValue === 'number' && typeof nextValue === 'number') {
    return prevValue + (nextValue - prevValue) * easedT;
  } else if (typeof prevValue === 'object' && typeof nextValue === 'object' && prevValue !== null && nextValue !== null) {
    // Object interpolation for position {x, y} and scale {scaleX, scaleY}
    const result: any = {};
    const prevKeys = Object.keys(prevValue);
    const nextKeys = Object.keys(nextValue);
    
    // Use all keys from both objects
    const allKeys = [...new Set([...prevKeys, ...nextKeys])];
    
    allKeys.forEach(key => {
      const prevVal = (prevValue as any)[key];
      const nextVal = (nextValue as any)[key];
      
      if (typeof prevVal === 'number' && typeof nextVal === 'number') {
        result[key] = prevVal + (nextVal - prevVal) * easedT;
      } else if (typeof prevVal === 'number') {
        result[key] = prevVal;
      } else if (typeof nextVal === 'number') {
        result[key] = nextVal;
      } else {
        result[key] = prevVal !== undefined ? prevVal : nextVal;
      }
    });
    
    return result;
  }

  return prevValue;
}; 