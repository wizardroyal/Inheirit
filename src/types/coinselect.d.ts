declare module "coinselect" {
  export interface CsUtxo { txId: string; vout: number; value: number; script?: Buffer }
  export interface CsTarget { address?: string; value?: number }
  export default function coinSelect(
    utxos: CsUtxo[],
    outputs: CsTarget[],
    feeRate: number,
  ): { inputs?: CsUtxo[]; outputs?: CsTarget[]; fee: number };
}
