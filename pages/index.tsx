import { useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi, getAddress, formatUnits } from 'viem'
import dynamic from 'next/dynamic'

// Widget da CoW somente no client (evita erro no SSR)
const CowSwapWidget = dynamic(
  async () => (await import('@cowprotocol/widget-react')).CowSwapWidget,
  { ssr: false }
)

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
  sellToken: string; buyToken: string; sellAmountWei: string; takerAddress: string; slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken,                      // 'ETH' (string) para nativo
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
    },
  })
  return {
    to: data.to,
    data: data.data,
    allowanceTarget: data.allowanceTarget || data.spender,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
  }
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [showCowCbBtc, setShowCowCbBtc] = useState(false)
  const [showCowEth, setShowCowEth] = useState(false)
  const [halfAmountWei, setHalfAmountWei] = useState<bigint>(0n)

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  const cowParamsCbBtc = useMemo(() => ({
    appCode: 'VamosPraCrypto-50-50',
    chainId: 8453,                       // Base
    tradeType: 'swap',
    sellToken: USDC,
    buyToken: CBBTC,
    sellAmount: halfAmountWei ? formatUnits(halfAmountWei, USDC_DECIMALS) : undefined,
    width: '100%',
    height: '680px',
    theme: { primaryColor: '#16a34a' },
  }), [halfAmountWei])

  const cowParamsEth = useMemo(() => ({
    appCode: 'VamosPraCrypto-50-50',
    chainId: 8453,
    tradeType: 'swap',
    sellToken: USDC,
    buyToken: 'ETH',                     // ETH nativo no widget
    sellAmount: halfAmountWei ? formatUnits(halfAmountWei, USDC_DECIMALS) : undefined,
    width: '100%',
    height: '680px',
    theme: { primaryColor: '#16a34a' },
  }), [halfAmountWei])

  async function handleExecute() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')

      setBusy(true)
      setShowCowCbBtc(false)
      setShowCowEth(false)
      setLog('Lendo saldo USDC on-chain...')

      const [dec, rawBal] = await Promise.all([
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
      ])
      if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
      if (rawBal === 0n) throw new Error('Sem USDC na Base.')

      const half = rawBal / 2n
      setHalfAmountWei(half)
      setLog(p => p + `\nMetade do USDC: ${formatUnits(half, USDC_DECIMALS)}.`)
      setLog(p => p + `\nBuscando cotações na 0x...`)

      // tenta 0x para as duas pernas
      let qCb: ZeroExQuote | null = null
      let qEth: ZeroExQuote | null = null

      try {
        qCb = await get0xQuoteBase({ sellToken: USDC, buyToken: CBBTC, sellAmountWei: half.toString(), takerAddress: address })
      } catch (err) {
        const ax = err as AxiosError<any>
        const code = ax.response?.status
        const reason = ax.response?.data?.reason || ax.response?.data?.validationErrors?.[0]?.reason || ax.message
        setLog(p => p + `\n⚠️ cbBTC via 0x falhou: ${code ?? ''} ${reason ?? ''}`)
        setShowCowCbBtc(true) // abre widget CoW
      }

      try {
        qEth = await get0xQuoteBase({ sellToken: USDC, buyToken: 'ETH', sellAmountWei: half.toString(), takerAddress: address })
      } catch (err) {
        const ax = err as AxiosError<any>
        const code = ax.response?.status
        const reason = ax.response?.data?.reason || ax.response?.data?.validationErrors?.[0]?.reason || ax.message
        setLog(p => p + `\n⚠️ ETH via 0x falhou: ${code ?? ''} ${reason ?? ''}`)
        setShowCowEth(true) // abre widget CoW
      }

      // se 0x conseguiu, executa on-chain
      if (qCb) {
        setLog(p => p + `\nEnviando swap USDC → cbBTC (0x)...`)
        const hash = await walletClient.sendTransaction({ to: qCb.to, data: qCb.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash })
        setLog(p => p + `\n✔️ cbBTC confirmado (0x).`)
      }
      if (qEth) {
        setLog(p => p + `\nEnviando swap USDC → ETH (0x)...`)
        const hash = await walletClient.sendTransaction({ to: qEth.to, data: qEth.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash })
        setLog(p => p + `\n✔️ ETH confirmado (0x).`)
      }

      if (showCowCbBtc || showCowEth) {
        setLog(p => p + `\n➡️ Para a(s) perna(s) sem rota na 0x, use o Widget da CoW abaixo.`)
      } else {
        setLog(p => p + `\n✅ Concluído!`)
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.reason ||
        e?.response?.data?.validationErrors?.[0]?.reason ||
        e?.shortMessage ||
        e?.message ||
        String(e)
      setLog(p => p + `\n❌ Erro: ${msg}`)
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: '40px auto', padding: 16 }}>
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

          {showCowCbBtc && (
            <>
              <h3 style={{ marginTop: 18 }}>Fallback CoW — USDC → cbBTC (50%)</h3>
              <CowSwapWidget {...cowParamsCbBtc} />
            </>
          )}

          {showCowEth && (
            <>
              <h3 style={{ marginTop: 18 }}>Fallback CoW — USDC → ETH (50%)</h3>
              <CowSwapWidget {...cowParamsEth} />
            </>
          )}
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
