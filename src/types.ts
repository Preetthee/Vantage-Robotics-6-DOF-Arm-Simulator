/** Joint configuration for the 6-DOF arm */
export interface JointData {
  name: string;
  angle: number;       // Radians
  minAngle: number;
  maxAngle: number;
  velocity: number;    // rad/s
  target: number;      // target angle
}

/** 6-DOF arm state */
export interface ArmState {
  joints: JointData[];
  endEffectorPosition: [number, number, number];
  endEffectorOrientation: [number, number, number]; // Euler angles
  status: 'idle' | 'running' | 'reached' | 'error';
  mode: ControlMode;
}

export type ControlMode = 'manual' | 'ik' | 'playback' | 'voice';

/** A single waypoint for playback */
export interface Waypoint {
  jointAngles: number[];
  label?: string;
}

/** Inverse Kinematics target */
export interface IKTarget {
  position: [number, number, number];
  orientation?: [number, number, number];
}