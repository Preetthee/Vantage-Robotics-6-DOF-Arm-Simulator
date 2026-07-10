import { FIREWORKS_API_KEY, FIREWORKS_MODEL, FIREWORKS_BASE_URL } from '../constants/config';

export type Vector3 = { x: number; y: number; z: number };

/** Small, deterministic action vocabulary used after free-speech planning. */
export type VoiceAction =
  | { kind: 'move_to'; target: Vector3 }
  | { kind: 'move_by'; delta: Vector3 }
  | { kind: 'rotate_joint'; joint: number; degrees: number }
  | { kind: 'joint_pose'; angles: number[] }
  | { kind: 'home' };

export interface VoicePlan {
  summary: string;
  actions: VoiceAction[];
}

export interface ParseResult {
  plan: VoicePlan;
  raw: string;
}

const MAX_ACTIONS = 6;
const MAX_RELATIVE_DISTANCE = 0.25; // metres per requested step

const SYSTEM_PROMPT = `You are a motion planner for a browser-based 6-axis robot arm. Convert free-form operator speech into a safe JSON plan.

Return ONLY one JSON object with this exact shape:
{"summary":"short plain-English summary","actions":[...]}

Allowed action objects:
- {"kind":"move_to","target":{"x":number,"y":number,"z":number}} for an absolute world target in metres.
- {"kind":"move_by","delta":{"x":number,"y":number,"z":number}} for a relative move in metres.
- {"kind":"rotate_joint","joint":1..6,"degrees":number}.
- {"kind":"joint_pose","angles":[six angles in degrees]}.
- {"kind":"home"}.

Rules:
- Interpret natural language freely, including multiple ordered requests. Produce at most 6 actions.
- Never invent missing coordinates. If a request is ambiguous, oversized, unsafe, or cannot be expressed safely, return {"summary":"reason and requested clarification","actions":[]}.
- A single relative move must not exceed 0.25 metres. Reject requests such as 2 km, 10 m, or 1 m instead of scaling them down.
- Use the provided live pose and panel coordinates when they make a request unambiguous.
- "up/down" change Y, "left/right" change X, and "forward/back" change Z.
- Do not include explanations, markdown, or any text outside JSON.`;

function isVector(value: unknown): value is Vector3 {
  if (!value || typeof value !== 'object') return false;
  const vector = value as Vector3;
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function validatePlan(value: unknown): VoicePlan {
  if (!value || typeof value !== 'object') throw new Error('The language model did not return a plan.');
  const plan = value as Partial<VoicePlan>;
  if (typeof plan.summary !== 'string' || !Array.isArray(plan.actions) || plan.actions.length > MAX_ACTIONS) {
    throw new Error('The language model returned an invalid motion plan.');
  }

  for (const action of plan.actions) {
    if (!action || typeof action !== 'object' || !('kind' in action)) throw new Error('The plan contains an invalid action.');
    const item = action as VoiceAction;
    if (item.kind === 'move_to' && !isVector(item.target)) throw new Error('A target position must contain finite x, y, and z values.');
    if (item.kind === 'move_by') {
      if (!isVector(item.delta)) throw new Error('A relative movement must contain finite x, y, and z values.');
      if (Math.hypot(item.delta.x, item.delta.y, item.delta.z) > MAX_RELATIVE_DISTANCE) {
        throw new Error('Requested relative movement exceeds the 250 mm safety limit.');
      }
    }
    if (item.kind === 'rotate_joint' && (!Number.isInteger(item.joint) || item.joint < 1 || item.joint > 6 || !Number.isFinite(item.degrees) || Math.abs(item.degrees) > 180)) {
      throw new Error('Joint rotation is outside the allowed range.');
    }
    if (item.kind === 'joint_pose' && (!Array.isArray(item.angles) || item.angles.length !== 6 || item.angles.some(angle => !Number.isFinite(angle)))) {
      throw new Error('A joint pose must contain exactly six finite angles.');
    }
    if (!['move_to', 'move_by', 'rotate_joint', 'joint_pose', 'home'].includes(item.kind)) {
      throw new Error('The plan contains an unsupported action.');
    }
  }
  return plan as VoicePlan;
}

/** Parse a JSON object even if a non-compliant model wraps it in prose. */
function extractJson(text: string): unknown {
  try { return JSON.parse(text.trim()); } catch { /* scan below */ }
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch { break; }
      }
    }
  }
  throw new Error('The language model did not return valid JSON. Please repeat the instruction.');
}

export async function parseFreeSpeech(
  transcript: string,
  context: { currentPosition: Vector3; panelPositions: Vector3[] },
  signal?: AbortSignal,
): Promise<ParseResult> {
  const { currentPosition, panelPositions } = context;
  const runtimeContext = `Current stylus position: (${currentPosition.x.toFixed(3)}, ${currentPosition.y.toFixed(3)}, ${currentPosition.z.toFixed(3)}). Panel positions 1-6: ${panelPositions.map((p, i) => `${i + 1}=(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`).join('; ')}.`;
  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIREWORKS_API_KEY}` },
    body: JSON.stringify({
      model: FIREWORKS_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `${runtimeContext}\nOperator: ${transcript}` }],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Voice planner error ${response.status}.`);
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Voice planner returned an empty response.');
  return { plan: validatePlan(extractJson(raw)), raw };
}
