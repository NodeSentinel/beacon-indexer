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
 * Converts a list of bits from a Uint8Array to a string representation.
 * Each bit in the array is converted to '1' or '0' in the output string, up to the last set bit.
 *
 * @param {Uint8Array} list - The Uint8Array containing bits to be converted.
 * @return {string} A string representation of the bits.
 */
export function convertBitsToString(list: Uint8Array): string {
  const lastBixDataIndex = findLastSetBitIndex(list);

  let buf = '';
  for (let i = 0; i < lastBixDataIndex; i++) {
    const bit = isBitSet(list, i);
    buf += bit ? '1' : '0';
  }
  return buf;
}

export function convertBitsToStringForCommitteeBits(list: Uint8Array): string {
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
