---
name: optimize-react-performance
description: Improve rendering performance and reduce unnecessary re-renders
---

# Optimize React Performance

## Instructions
- Detect unnecessary re-renders
- Suggest useMemo / useCallback only when needed
- Avoid premature optimization
- Measure before optimizing

## Examples
Input: component re-renders too often
Output:
- Cause: props reference changes
- Fix: memoization