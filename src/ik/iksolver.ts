/**
 * IK Solver — Jacobian pseudoinverse for a serial arm.
 *
 * Uses the geometric Jacobian computed from the actual URDF scene graph.
 * Each revolute joint's contribution to end-effector motion is:
 *   J_i = [ a_i × (p_ee - p_i) ]   (3 position rows)
 *         [ a_i                   ]   (3 orientation rows)
 */

import * as THREE from 'three';

export interface JointInfo {
  /** Joint object in the scene graph */
  object: THREE.Object3D;
  /** Local axis of rotation (from URDF) */
  axis: THREE.Vector3;
  /** Current angle in radians */
  angle: number;
  /** Joint index in the state array */
  stateIndex: number;
}

export interface IKSolution {
  angles: number[];
  error: number;
  iterations: number;
  converged: boolean;
}

/**
 * Compute the 6×N geometric Jacobian for the arm.
 * @param joints   Array of joint info (order matters — matches the column order)
 * @param eeWorld  End-effector world position
 * @returns 6×N Jacobian matrix as flat arrays (6 arrays of length N)
 */
function computeJacobian(
  joints: JointInfo[],
  eeWorld: THREE.Vector3,
): number[][] {
  const n = joints.length;
  // 6 rows × n columns — each row is an array of length n
  const J: number[][] = Array.from({ length: 6 }, () => new Array(n).fill(0));

  const jointWorldPos = new THREE.Vector3();
  const jointWorldAxis = new THREE.Vector3();

  for (let j = 0; j < n; j++) {
    const joint = joints[j];

    // Get joint position in world space
    joint.object.getWorldPosition(jointWorldPos);

    // Get joint axis in world space
    // The axis is defined in the joint's PARENT frame (URDF convention).
    // We need to transform it to world coordinates using the parent's world rotation.
    const parent = joint.object.parent;
    if (parent) {
      const parentQuat = new THREE.Quaternion();
      parent.getWorldQuaternion(parentQuat);
      jointWorldAxis.copy(joint.axis).applyQuaternion(parentQuat);
    } else {
      jointWorldAxis.copy(joint.axis);
    }
    jointWorldAxis.normalize();

    // Position row: a × (p_ee - p_joint)
    const r = new THREE.Vector3().copy(eeWorld).sub(jointWorldPos);
    const cross = new THREE.Vector3().crossVectors(jointWorldAxis, r);

    J[0][j] = cross.x;
    J[1][j] = cross.y;
    J[2][j] = cross.z;

    // Orientation row: a (unit axis of rotation)
    J[3][j] = jointWorldAxis.x;
    J[4][j] = jointWorldAxis.y;
    J[5][j] = jointWorldAxis.z;
  }

  return J;
}

/**
 * Moore–Penrose pseudoinverse via J⁺ = Jᵀ(J Jᵀ)⁻¹
 * Works for 6×N matrices where J Jᵀ is 6×6.
 */
function pseudoinverse(J: number[][]): number[][] | null {
  const rows = J.length;       // 6
  const cols = J[0].length;     // N

  // Compute J * J^T (6×6)
  const JJt: number[][] = Array.from({ length: rows }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < rows; k++) {
      let sum = 0;
      for (let j = 0; j < cols; j++) {
        sum += J[i][j] * J[k][j];
      }
      JJt[i][k] = sum;
    }
  }

  // Invert JJt (6×6) using Gauss-Jordan elimination
  const inv = invertMatrix6(JJt);
  if (!inv) return null;

  // J^T × inv(JJt) → N×6
  const Jpinv: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < cols; i++) {
    for (let k = 0; k < rows; k++) {
      let sum = 0;
      for (let j = 0; j < rows; j++) {
        sum += J[j][i] * inv[j][k];
      }
      Jpinv[i][k] = sum;
    }
  }

  return Jpinv;
}

/** Gauss-Jordan elimination for a 6×6 matrix. Returns null if singular. */
function invertMatrix6(M: number[][]): number[][] | null {
  const n = 6;
  // Augmented matrix [M | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = [...M[i]];
    for (let j = 0; j < n; j++) {
      row.push(i === j ? 1 : 0);
    }
    return row;
  });

  for (let col = 0; col < n; col++) {
    // Pivot: find row with largest absolute value
    let pivotRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = row;
      }
    }

    if (maxVal < 1e-10) return null; // Singular

    // Swap rows
    if (pivotRow !== col) {
      [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    }

    // Normalize pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse from the right half
  const inv: number[][] = Array.from({ length: n }, (_, i) =>
    aug[i].slice(n, 2 * n),
  );
  return inv;
}

/**
 * Compute the damping factor for DLS (Damped Least Squares) to handle
 * singularities gracefully.
 */
function dampingFactor(J: number[][], maxDamping: number = 0.1): number {
  // Compute max singular value squared via power iteration (approx)
  let sum = 0;
  for (let i = 0; i < J.length; i++) {
    for (let j = 0; j < J[0].length; j++) {
      sum += J[i][j] * J[i][j];
    }
  }
  const avgSq = sum / (J.length * J[0].length);
  // Damping = maxDamping near singularities, ~0 away from them
  return maxDamping / (1 + avgSq * 100);
}

/**
 * Perform one IK iteration step.
 * Returns the joint angle deltas to apply.
 */
function ikStep(
  joints: JointInfo[],
  targetPosition: THREE.Vector3,
  currentEEPosition: THREE.Vector3,
  stepSize: number,
  useOrientation: boolean,
  targetOrientation?: THREE.Quaternion,
  currentEEOrientation?: THREE.Quaternion,
): { deltas: number[]; error: number } | null {
  const n = joints.length;
  const J = computeJacobian(joints, currentEEPosition);

  // Position error (3 elements)
  const posError = new THREE.Vector3().copy(targetPosition).sub(currentEEPosition);

  // Full 6-element error vector
  let error6: number[];
  if (useOrientation && targetOrientation && currentEEOrientation) {
    // Orientation error as angle-axis
    const oriError = new THREE.Quaternion()
      .copy(targetOrientation)
      .multiply(currentEEOrientation.clone().invert());
    const angle = 2 * Math.acos(Math.min(1, Math.max(-1, oriError.w)));
    const axis = new THREE.Vector3(oriError.x, oriError.y, oriError.z);
    if (axis.lengthSq() > 0) axis.normalize();
    error6 = [
      posError.x, posError.y, posError.z,
      axis.x * angle, axis.y * angle, axis.z * angle,
    ];
  } else {
    error6 = [posError.x, posError.y, posError.z, 0, 0, 0];
  }

  const errorNorm = Math.sqrt(
    error6[0] ** 2 + error6[1] ** 2 + error6[2] ** 2 +
    error6[3] ** 2 + error6[4] ** 2 + error6[5] ** 2,
  );

  // Damped pseudoinverse: J⁺ = Jᵀ(J Jᵀ + λ²I)⁻¹
  // For simplicity, we implement as: pseudoinverse but add damping to JJt
  // We'll use the basic pseudoinverse with step clamping

  const Jpinv = pseudoinverse(J);
  if (!Jpinv) return null;

  // Δq = J⁺ × error
  const deltas = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < 6; k++) {
      sum += Jpinv[i][k] * error6[k];
    }
    deltas[i] = sum * stepSize;
  }

  // Clamp deltas to prevent wild swings
  const maxDelta = 0.5; // radians per step
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(deltas[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  if (maxAbs > maxDelta) {
    const scale = maxDelta / maxAbs;
    for (let i = 0; i < n; i++) {
      deltas[i] *= scale;
    }
  }

  return { deltas, error: errorNorm };
}

/**
 * Full IK solver — runs multiple iterations to convergence.
 * @param joints    Array of JointInfo (current state)
 * @param target    Target world position
 * @param options   Solver options
 * @returns         Solution with new angles
 */
export function solveIK(
  joints: JointInfo[],
  target: THREE.Vector3,
  options: {
    maxIterations?: number;
    positionTolerance?: number;
    stepSize?: number;
    useOrientation?: boolean;
    targetOrientation?: THREE.Quaternion;
    getEEPosition: () => THREE.Vector3;
    getEEOrientation?: () => THREE.Quaternion;
    applyAngles: (angles: number[]) => void;
    readAngles: () => number[];
  },
): IKSolution {
  const maxIter = options.maxIterations ?? 50;
  const posTol = options.positionTolerance ?? 0.005; // 5mm
  const stepSize = options.stepSize ?? 0.3;
  const useOri = options.useOrientation ?? false;

  const angles = options.readAngles();
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    // Apply current angles to the scene
    options.applyAngles(angles);

    // Get current end-effector pose
    const eePos = options.getEEPosition();

    // Build joint info with updated angles
    const jointInfo = joints.map((j, i) => ({
      ...j,
      angle: angles[i],
    }));

    // Compute step
    let targetOri: THREE.Quaternion | undefined;
    let currentOri: THREE.Quaternion | undefined;
    if (useOri) {
      targetOri = options.targetOrientation;
      currentOri = options.getEEOrientation?.();
    }

    const result = ikStep(
      jointInfo, target, eePos, stepSize,
      useOri, targetOri, currentOri,
    );

    if (!result) break;

    // Apply deltas
    for (let i = 0; i < angles.length; i++) {
      angles[i] += result.deltas[i];
    }

    iterations = iter + 1;

    // Check convergence
    if (result.error < posTol) {
      break;
    }
  }

  // Final apply
  options.applyAngles(angles);

  const finalEE = options.getEEPosition();
  const finalError = finalEE.distanceTo(target);

  return {
    angles,
    error: finalError,
    iterations,
    converged: finalError < posTol * 2,
  };
}