/**
 * Checks if a specific bit is set in a Uint8Array.
 * This function determines if the bit at position 'i' in the provided bit list is set (1).
 *
 * @param {Uint8Array} bitList - The array containing the bits.
 * @param {number} i - The index of the bit to check.
 * @return {boolean} True if the bit is set, false otherwise.
 */
export function isBitSet(bitList: Uint8Array, i: number): boolean {
  const byte = Math.floor(i / 8);
  const bits = bitList[byte];
  const bitPosition = i % 8;
  // bitwise AND operation
  return (bits! & (1 << bitPosition)) > 0;
}

/**
 * Converts a hexadecimal string into a Uint8Array.
 * This function parses a string of hexadecimal values and converts it into an array of bytes.
 *
 * @param {string} hex - The hexadecimal string to be converted.
 * @return {Uint8Array} The byte array representation of the hexadecimal string.
 * @throws {Error} Throws an error if the hexadecimal string cannot be parsed.
 */
export function convertHexStringToByteArray(hex: string): Uint8Array {
  const cleanedHex = hex.startsWith('0x') ? hex.substring(2) : hex;
  const length = cleanedHex.length;
  const byteArray = new Uint8Array(length / 2);

  for (let i = 0, j = 0; i < length; i += 2, j++) {
    byteArray[j] = parseInt(cleanedHex.substring(i, i + 2), 16);
  }

  return byteArray;
}

/**
 * Finds the index of the last set bit in a bit list.
 * According to the SSZ spec, bitlist have an added termination bit, which should be considered.
 * For more details see: https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md#bitlistn
 *
 * @param {Uint8Array} list - The bit list represented as a Uint8Array.
 * @return {number} The index of the last set bit in the list.
 */
export function findLastSetBitIndex(list: Uint8Array): number {
  const totalBits = list.length * 8;
  for (let i = totalBits - 1; i >= 0; i--) {
    if (isBitSet(list, i)) {
      return i;
    }
  }
  return -1;
}

/**
 * Converts a SSZ Bitlist (variable length) from a Uint8Array to a string representation.
 * Each bit in the array is converted to '1' or '0' in the output string, up to the last set bit.
 * The last set bit is the termination bit according to the SSZ spec and is excluded from the result.
 *
 * SSZ bit numbering rules:
 * - Bits are indexed from least significant (bit0) to most significant (bit7) within each byte.
 * - Byte 0 contains bits 0–7, byte 1 contains bits 8–15, and so on.
 * - Bit0 corresponds to the lowest-value bit (0x01) of byte0.
 * - The termination bit (highest bit set to 1) marks the end of the data.
 *
 * @param {Uint8Array} list - The Uint8Array containing bits to be converted (SSZ Bitlist format).
 * @return {string} A string representation of the bits (excluding the termination bit).
 *
 * @example
 * // Example 1 — Single byte
 * // Input: 0x03 → [0x03]
 * //
 * // Bits in byte0 (bit7→bit0):
 * // bit7 bit6 bit5 bit4 bit3 bit2 bit1 bit0
 * //  0    0    0    0    0    0    1    1
 * //
 * // Highest bit set → bit1 (termination)
 * // Data bits → bit0
 * //
 * // Output: "1"
 *
 * @example
 * // Example 2 — Multiple bits in one byte
 * // Input: 0x0F → [0x0F]
 * //
 * // Bits in byte0 (bit7→bit0):
 * // bit7 bit6 bit5 bit4 bit3 bit2 bit1 bit0
 * //  0    0    0    0    1    1    1    1
 * //
 * // Highest bit set → bit3 (termination)
 * // Data bits → bit0, bit1, bit2
 * //
 * // Output: "111"
 *
 * @example
 * // Example 3 — Multiple bytes
 * // Input: 0xFF00 → [0xFF, 0x00]
 * //
 * // Bits (bit15→bit0):
 * //  0 0 0 0 0 0 0 0 1 1 1 1 1 1 1 1
 * //  ↑ bits15......8 ↑ bits7.......0
 * //    (byte1 = 0x00)    (byte0 = 0xFF)
 * //
 * // Highest bit set → bit7 (termination)
 * // Data bits → bit0..bit6
 * //
 * // Output: "1111111"
 */
export function convertVariableBitsToString(list: Uint8Array): string {
  const lastBixDataIndex = findLastSetBitIndex(list);

  let buf = '';
  for (let i = 0; i < lastBixDataIndex; i++) {
    const bit = isBitSet(list, i);
    buf += bit ? '1' : '0';
  }
  return buf;
}

/**
 * Converts a SSZ Bitvector (fixed length) from a Uint8Array to a string representation.
 * Each bit in the array is converted to '1' or '0' in the output string, processing all bits.
 *
 * SSZ bit numbering rules:
 * - Bits are indexed from least significant (bit0) to most significant (bit7) within each byte.
 * - Byte 0 contains bits 0–7, byte 1 contains bits 8–15, and so on.
 * - Bit0 corresponds to the lowest-value bit (0x01) of byte0.
 * - Bitvector has a fixed size — no termination bit is used.
 *
 * For more details:
 * https://github.com/ethereum/consensus-specs/blob/dev/ssz/simple-serialize.md#bitvectorn
 * https://ethereum.github.io/consensus-specs/ssz/simple-serialize/#bitvectorn
 *
 * @param {Uint8Array} list - The Uint8Array containing bits to be converted (SSZ Bitvector format).
 * @return {string} A string representation of all bits in SSZ order.
 *
 * @example
 * // Example 1 — Single byte
 * // Input: 0x03 → [0x03]
 * //
 * // Bits in byte0 (bit7→bit0):
 * // bit7 bit6 bit5 bit4 bit3 bit2 bit1 bit0
 * //  0    0    0    0    0    0    1    1
 * //
 * // Output (bit0→bit7): "11000000"
 *
 * @example
 * // Example 2 — Two bytes
 * // Input: 0xFF00 → [0xFF, 0x00]
 * //
 * // Bits (bit15→bit0):
 * //  0 0 0 0 0 0 0 0 1 1 1 1 1 1 1 1
 * //  ↑ bits15......8 ↑ bits7.......0
 * //    (byte1 = 0x00)    (byte0 = 0xFF)
 * //
 * // Output (bit0→bit15): "1111111100000000"
 *
 * @example
 * // Example 3 — Eight bytes
 * // Input: 0x4080008084009802 → [0x40, 0x80, 0x00, 0x80, 0x84, 0x00, 0x98, 0x02]
 * //
 * // Bits in SSZ order (bit0→bit63):
 * // byte0 bits0–7:  0 0 0 0 0 0 1 0
 * // byte1 bits8–15:  0 0 0 0 0 0 0 1
 * // ... and so on
 * //
 * // Output: "0000001000000001..." (all 64 bits)
 */
export function convertFixedBitsToString(list: Uint8Array): string {
  const totalBits = list.length * 8;
  let buf = '';
  for (let i = 0; i < totalBits; i++) {
    const bit = isBitSet(list, i);
    buf += bit ? '1' : '0';
  }
  return buf;
}

/**
 * Formats a string of bits into blocks separated by spaces, where each block represents a byte.
 * This function improves readability by grouping every 8 bits into a block, separated by a space.
 *
 * @param {string} list - A string of bits to be formatted.
 * @return {string} The formatted string with bits grouped in byte blocks.
 */
export function formatBitsAsByteBlocks(list: string): string {
  return list
    .split('')
    .reduce(
      (acc, bit, index) =>
        acc + bit + ((index + 1) % 8 === 0 && index + 1 !== list.length ? ' ' : ''),
      '',
    );
}
