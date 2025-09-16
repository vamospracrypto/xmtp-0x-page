// pages/index.tsx
import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useBalance,
} from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi } from 'viem'
import { getAddress, formatUnits } from 'viem'

const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')
const USDC_DECIMALS = 6

type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
}

async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string // ERC-20 ou 'ETH'
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const url = 'https://base.api.0x.org/swap/v1/quote'
  const { data } = await axios.get(url, {
    params: {
      sellToken,
      buyToken, // use 'ETH' string para nativo
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
    },
  })
  return {
    to: data.to as `0x${string}`,
    data: data.data as `0x${string}`,
    allowanceTarget: (data.allowanceTarget || data.spender) as `0x${string}`,
    buyAmount: data.buyAmount as string,
    sellAmount: data.sellAmount as string,
  }
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string>('')

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  async function handleExecute() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')

      setBusy(true)
      setLog('Lendo saldo USDC on-chain...')

      const [dec, rawBal] = await Promise.all([
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
      ])
      if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
      if (rawBal === 0n) throw new Error('Sem USDC na Base.')

      const half = rawBal / 2n
      setLog((p) => p + `\nMetade do USDC: ${formatUnits(half, USDC_DECIMALS)}.`)

      setLog((p) => p + `\nBuscando cotações na 0x...`)

      // Tenta cbBTC. Se 404 (sem rota), fazemos fallback p/ ETH-only
      let qCb: ZeroExQuote | null = null
      let qEthHalf: ZeroExQuote | null = null
      let fallbackAllToEth = false
      try {
        qCb = await get0xQuoteBase({ sellToken: USDC, buyToken: CBBTC, sellAmountWei: half.toString(), takerAddress: address })
      } catch (err) {
        const ax = err as AxiosError<any>
        const code = ax.response?.status
        const reason = ax.response?.data?.reason || ax.response?.data?.validationErrors?.[0]?.reason
        setLog((p) => p + `\n⚠️ cbBTC indisponível: ${code || ''} ${reason || ''}`)

        if (code === 404) {
          fallbackAllToEth = true
        } else {
          throw err
        }
      }

      if (!fallbackAllToEth) {
        // metade → ETH
        qEthHalf = await get0xQuoteBase({ sellToken: USDC, buyToken: 'ETH', sellAmountWei: half.toString(), takerAddress: address })
      }

      // Se não teve rota p/ cbBTC, converte 100% p/ ETH:
      let qEthAll: ZeroExQuote | null = null
      if (fallbackAllToEth) {
        setLog((p) => p + `\nSem rota p/ cbBTC. Fallback: 100% do USDC → ETH.`)
        qEthAll = await get0xQuoteBase({ sellToken: USDC, buyToken: 'ETH', sellAmountWei: rawBal.toString(), takerAddress: address })
      }

      // Montar approvals por spender (somatório do que de fato será gasto em USDC)
      const porSpender = new Map<string, bigint>()
      const add = (q?: ZeroExQuote | null) => {
        if (!q) return
        const sp = q.allowanceTarget
        if (!sp) return
        const cur = porSpender.get(sp) ?? 0n
        porSpender.set(sp, cur + BigInt(q.sellAmount))
      }
      add(qCb)
      add(qEthHalf)
      add(qEthAll)

      for (const [spender, total] of porSpender) {
        setLog((p) => p + `\nChecando allowance para ${spender}...`)
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, spender as `0x${string}`],
        }) as bigint

        if (allowance < total) {
          setLog((p) => p + `\nAprovando USDC (${formatUnits(total, USDC_DECIMALS)}) para ${spender}...`)
          const approveHash = await walletClient.writeContract({
            address: USDC,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender as `0x${string}`, total],
            chain: base,
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
          setLog((p) => p + `\n✔️ Approve confirmado.`)
        } else {
          setLog((p) => p + `\nApprove já suficiente.`)
        }
      }

      // Executar swaps conforme o cenário
      if (!fallbackAllToEth) {
        // 50% → cbBTC
        setLog((p) => p + `\nEnviando swap USDC → cbBTC...`)
        const tx1 = await walletClient.sendTransaction({ to: qCb!.to, data: qCb!.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: tx1 })
        setLog((p) => p + `\n✔️ Swap cbBTC confirmado.`)

        // 50% → ETH
        setLog((p) => p + `\nEnviando swap USDC → ETH (nativo)...`)
        const tx2 = await walletClient.sendTransaction({ to: qEthHalf!.to, data: qEthHalf!.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: tx2 })
        setLog((p) => p + `\n✔️ Swap ETH confirmado.`)
      } else {
        // 100% → ETH
        setLog((p) => p + `\nEnviando swap 100% USDC → ETH...`)
        const tx = await walletClient.sendTransaction({ to: qEthAll!.to, data: qEthAll!.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: tx })
        setLog((p) => p + `\n✔️ Swap ETH confirmado.`)
      }

      setLog((p) => p + `\n✅ Concluído!`)
    } catch (e: any) {
      const msg =
        e?.response?.data?.reason ||
        e?.response?.data?.validationErrors?.[0]?.reason ||
        e?.shortMessage ||
        e?.message ||
        String(e)
      setLog((p) => p + `\n❌ Erro: ${msg}`)
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Executar 50/50 Swap</h1>

      <ConnectButton />

      {isConnected ? (
        <>
          <p style={{ marginTop: 16 }}>
            Saldo em USDC: {usdcBalUi ? `${usdcBalUi.formatted} ${usdcBalUi.symbol}` : '-'}
          </p>

          <button
            onClick={handleExecute}
            disabled={busy}
            style={{
              marginTop: 16,
              padding: '12px 20px',
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 10,
              background: '#16a34a',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {busy ? 'Processando…' : 'Executar 50/50'}
          </button>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          <p style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
            Tenha ETH na Base para o gás. Slippage 0,5% (ajuste no código, se quiser).
          </p>
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
