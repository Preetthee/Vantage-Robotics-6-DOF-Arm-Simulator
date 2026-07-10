import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ArmState, ControlMode, IKTarget, JointData } from '../types';

const DEFAULT_ARM_STATE: ArmState = {
  joints: [
    { name: 'joint_1', angle: 0, minAngle: -Math.PI, maxAngle: Math.PI, velocity: 0, target: 0 },
    { name: 'joint_2', angle: 0, minAngle: -Math.PI * 0.5, maxAngle: Math.PI * 0.5, velocity: 0, target: 0 },
    { name: 'joint_3', angle: 0, minAngle: -Math.PI * 0.75, maxAngle: Math.PI * 0.75, velocity: 0, target: 0 },
    { name: 'joint_4', angle: 0, minAngle: -Math.PI, maxAngle: Math.PI, velocity: 0, target: 0 },
    { name: 'joint_5', angle: 0, minAngle: -Math.PI * 0.5, maxAngle: Math.PI * 0.5, velocity: 0, target: 0 },
    { name: 'joint_6', angle: 0, minAngle: -Math.PI, maxAngle: Math.PI, velocity: 0, target: 0 },
  ],
  endEffectorPosition: [0, 0, 0],
  endEffectorOrientation: [0, 0, 0],
  status: 'idle',
  mode: 'manual',
  ikTarget: null,
};

interface ArmStateContextValue {
  state: ArmState;
  updateJointAngle: (index: number, angle: number) => void;
  updateJointTarget: (index: number, target: number) => void;
  updateJointAngles: (angles: number[]) => void;
  initializeJoints: (joints: JointData[]) => void;
  setMode: (mode: ControlMode) => void;
  setStatus: (status: ArmState['status']) => void;
  setEndEffectorPose: (pos: [number, number, number], ori: [number, number, number]) => void;
  resetPose: () => void;
  setIKTarget: (target: IKTarget | null) => void;
}

const ArmStateContext = createContext<ArmStateContextValue | null>(null);

export function ArmStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ArmState>(DEFAULT_ARM_STATE);

  const updateJointAngle = useCallback((index: number, angle: number) => {
    setState(prev => {
      const joints = [...prev.joints];
      joints[index] = { ...joints[index], angle };
      return { ...prev, joints };
    });
  }, []);

  const updateJointTarget = useCallback((index: number, target: number) => {
    setState(prev => {
      const joints = [...prev.joints];
      joints[index] = { ...joints[index], target };
      return { ...prev, joints };
    });
  }, []);

  const updateJointAngles = useCallback((angles: number[]) => {
    setState(prev => {
      const joints = prev.joints.map((j, i) =>
        i < angles.length ? { ...j, angle: angles[i] } : j
      );
      return { ...prev, joints };
    });
  }, []);

  const setMode = useCallback((mode: ControlMode) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  const setStatus = useCallback((status: ArmState['status']) => {
    setState(prev => ({ ...prev, status }));
  }, []);

  const setEndEffectorPose = useCallback(
    (pos: [number, number, number], ori: [number, number, number]) => {
      setState(prev => ({ ...prev, endEffectorPosition: pos, endEffectorOrientation: ori }));
    },
    [],
  );

  const initializeJoints = useCallback((joints: JointData[]) => {
    setState(prev => ({
      ...prev,
      joints,
      status: 'idle',
      endEffectorPosition: [0, 0, 0],
      endEffectorOrientation: [0, 0, 0],
    }));
  }, []);

  const resetPose = useCallback(() => {
    setState(prev => ({
      ...prev,
      joints: prev.joints.map(j => ({ ...j, angle: 0, target: 0 })),
      status: 'idle',
    }));
  }, []);

  const setIKTarget = useCallback((target: IKTarget | null) => {
    setState(prev => ({ ...prev, ikTarget: target }));
  }, []);

  return (
    <ArmStateContext.Provider
      value={{
        state,
        updateJointAngle,
        updateJointTarget,
        updateJointAngles,
        initializeJoints,
        setMode,
        setStatus,
        setEndEffectorPose,
        resetPose,
        setIKTarget,
      }}
    >
      {children}
    </ArmStateContext.Provider>
  );
}

export function useArmState() {
  const ctx = useContext(ArmStateContext);
  if (!ctx) throw new Error('useArmState must be used within ArmStateProvider');
  return ctx;
}