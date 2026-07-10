/**
 * Quick Fireworks API key test.
 * Import and call testFireworksKey() — logs result to console.
 */

import { FIREWORKS_API_KEY, FIREWORKS_MODEL, FIREWORKS_BASE_URL } from './constants/config';

export async function testFireworksKey(): Promise<boolean> {
  console.log('🔑 Testing Fireworks API key...');
  console.log(`   Model: ${FIREWORKS_MODEL}`);
  console.log(`   Key (first 4 chars): ${FIREWORKS_API_KEY.slice(0, 4)}...`);

  try {
    const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FIREWORKS_API_KEY}`,
      },
      body: JSON.stringify({
        model: FIREWORKS_MODEL,
        messages: [
          {
            role: 'user',
            content: 'Say "API key works" and nothing else.',
          },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API request failed (${response.status}): ${text}`);
      return false;
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    console.log(`✅ Fireworks API is working! Response: "${reply}"`);
    return true;
  } catch (err: any) {
    console.error(`❌ Network error: ${err.message}`);
    return false;
  }
}