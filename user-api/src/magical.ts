import { getNetworkDisplayName } from './networks.js';

export type MagicalEventCategory = 'generation' | 'compilation' | 'errors' | 'deployment' | 'celebration' | 'bonus';

export const MAGIC_TEMPLATES = {
  generation: [
    'Summoning the ancient scrolls of Solidity…',
    'The Blockchain Alchemist dips their quill into digital ink…',
    'Channeling your prompt into bytecode starlight…',
    'Your words ripple across the EVM plane… Solidity responds.',
    'Brewing smart contract elixirs from your imagination cauldron…',
    'Architecting your digital relic with care and stardust…',
    'Thinking○●○ Casting spells…',
    'Transmuting ideas into Solidity runes [███░░░░░] 30%',
  ],
  compilation: [
    'Deciphering runes of inheritance…',
    'The Solidity Sage squints: ‘These imports look… suspicious.’',
    'Encountered a forbidden rune! Re-drawing the sigil…',
    'Alchemy in progress: transmuting errors into wisdom…',
    'Learning the blockchain dialects… (Attempt ${iteration}/${max})',
    'The compiler frowns, but the Wizard smiles — for riddles teach resilience.',
    'A spectral whisper: ‘Check your override incantations…’',
    'Gathering ethereal dependencies from the Library of OpenZeppelin…',
    '✨ At last! ${count} scrolls of Solidity compiled successfully.',
  ],
  errors: [
    '⚠️ Ancient curse detected: missing dependency!',
    'The spirits of gas cost whisper warnings…',
    'Forbidden glyph uncovered — adjusting function sigils…',
    'The EVM demands tribute: correct constructor arguments!',
    'Oops! Summoning circle misdrawn, recalibrating…',
    'Another blockchain riddle presents itself…',
    'Learning from the spirits of the chain… retrying incantation…',
  ],
  deployment: [
    'The summoning circle glows brighter…',
    'Channeling ether into your contract vessel…',
    'Deployment beam ignites, the ritual nears completion…',
    'The void trembles — manifesting your creation…',
    'The seal is drawn. Anchoring into ${networkLabel} reality…',
    'A new address emerges from the void: ${address} ✨',
    'Forging your legend into the blockchain’s eternal ledger…',
  ],
  celebration: [
    '🎉 Success! Your creation lives on the blockchain!',
    'The digital golem awakens, ready to serve its master.',
    'From prompt to permanence: mission accomplished.',
    'Your NFT relics now shimmer across the metaverse.',
    'Code transformed into chain-bound legend.',
    'The ritual is sealed. Congratulations, Blockchain Wizard! 🧙‍♂️',
    '✨ Behold! ${contractName} now stands immortal on-chain.',
  ],
  bonus: [
    'Thinking●○○ → Thinking○●○ → Thinking○○●',
    'Charging mana: [▓▓▓▓░░░░░░] 40%',
    'Stitching bytecode fibers… [███████░░░] 70%',
    'Fun fact: ERC721 contracts love a safe `mint` ritual.',
    'Did you know? Pausable spells act like emergency stop buttons.',
  ],
} as const;

export function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] as T; }

export function networkPretty(name?: string): string {
  if (!name) return 'the network';
  return getNetworkDisplayName(name);
}

export function magicalFromLog(
  message: string,
  ctx: { network?: string; contractName?: string }
): Array<{ category: MagicalEventCategory; msg: string; meta?: { contractName?: string; address?: string } }> {
  const out: Array<{ category: MagicalEventCategory; msg: string; meta?: { contractName?: string; address?: string } }> = [];
  const m = String(message || '');

  // Generation
  if (/Stage:\s*generate/i.test(m)) {
    out.push({ category: 'generation', msg: pick(MAGIC_TEMPLATES.generation) });
  }
  const mGen = m.match(/Generation done in\s*(\d+)ms\.\s*Code size=(\d+)/i);
  if (mGen) {
    const ms = parseInt(mGen[1], 10) || 0;
    const secs = Math.max(1, Math.round(ms / 1000));
    const runes = mGen[2];
    out.push({ category: 'generation', msg: `✅ Generation complete in ${secs}s — ${Number(runes).toLocaleString()} runes etched.` });
  }

  // Compilation
  if (/Stage:\s*compile/i.test(m)) {
    out.push({ category: 'compilation', msg: pick(MAGIC_TEMPLATES.compilation) });
  }
  const mIter = m.match(/iter\s*(\d+)\/(\d+):\s*compile\s*(ok|failed)/i);
  if (mIter) {
    const iteration = mIter[1]; const max = mIter[2]; const status = mIter[3].toLowerCase();
    if (status === 'failed') out.push({ category: 'compilation', msg: `Learning the blockchain dialects… (Attempt ${iteration}/${max})` });
  }
  const mCompiled = m.match(/Compiled\s+(\d+)\s+Solidity files successfully/i);
  if (mCompiled) {
    const count = mCompiled[1];
    out.push({ category: 'compilation', msg: `✨ At last! ${count} scrolls of Solidity compiled successfully.` });
  }

  // Errors / warnings
  if (/(?:\bERROR\b|TypeError:|SyntaxError:|Warning:)/i.test(m)) {
    out.push({ category: 'errors', msg: pick(MAGIC_TEMPLATES.errors) });
  }

  // Deployment selection
  const mChosen = m.match(/Contract chosen for deploy:\s*([A-Za-z0-9_]+)/i);
  if (mChosen) {
    const name = mChosen[1];
    out.push({ category: 'deployment', msg: `The summoning circle glows brighter… anchoring ${name} to ${networkPretty(ctx.network)}.` , meta: { contractName: name } });
  }
  const mNet = m.match(/Stage:\s*deploy\s*->\s*network\s*([A-Za-z0-9_\-]+)/i);
  if (mNet) {
    const net = networkPretty(mNet[1]);
    out.push({ category: 'deployment', msg: `The seal is drawn. Anchoring into ${net} reality…` });
  }
  const mAddr = m.match(/Deploy success\. Address=(0x[a-fA-F0-9]{40})/);
  if (mAddr) {
    const addr = mAddr[1];
    out.push({ category: 'deployment', msg: `A new address emerges from the void: ${addr} ✨`, meta: { address: addr } });
    out.push({ category: 'celebration', msg: `✨ Behold! ${ctx.contractName || 'Your contract'} now stands immortal on-chain.` });
  }
  const mRelic = m.match(/DEPLOY_RESULT\s+({[\s\S]*})/);
  if (mRelic) {
    try {
      const obj = JSON.parse(mRelic[1]);
      const addr = obj?.address as string | undefined;
      if (addr) {
        out.push({ category: 'deployment', msg: `A new address emerges from the void: ${addr} ✨`, meta: { address: addr } });
        out.push({ category: 'celebration', msg: `✨ Behold! ${ctx.contractName || (obj as any)?.contract || 'Your contract'} now stands immortal on-chain.` });
      }
    } catch {}
  }

  return out;
}
