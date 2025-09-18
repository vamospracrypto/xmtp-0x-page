// pages/index.tsx
import { useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi, formatUnits, getAddress } from 'viem'
import Image from 'next/image'

const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')
const USDC_DECIMALS = 6
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || ''

type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
}

async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string // ERC20 addr ou 'ETH'
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken,
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
  const [showCow, setShowCow] = useState(false)
  const [halfAmountWei, setHalfAmountWei] = useState<bigint>(0n)
  const [enableZeroX, setEnableZeroX] = useState(false)
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [balances, setBalances] = useState<
    { symbol: string; name: string; contract: string; balance: string }[]
  >([])

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  const cowUrlCbBtc = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/${CBBTC}?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
  }, [halfAmountWei])
  const cowUrlEth = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/ETH?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
  }, [halfAmountWei])

  async function prepareAmountsAndShowCow() {
    if (!address || !publicClient) return
    if (chainId !== base.id) throw new Error('Troque a rede para Base.')
    setShowCow(false)
    setLog('Lendo saldo USDC on-chain...')

    const [dec, rawBal] = await Promise.all([
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }) as Promise<bigint>,
    ])
    if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
    if (rawBal === 0n) throw new Error('Sem USDC na Base.')

    const half = rawBal / 2n
    setHalfAmountWei(half)
    setLog((p) => p + `\nMetade do USDC: ${formatUnits(half, USDC_DECIMALS)}.`)
    setShowCow(true)
  }

  async function handleExecuteCowFirst() {
    try {
      setBusy(true)
      await prepareAmountsAndShowCow()
      setEnableZeroX(true)
      setLog((p) => p + `\nWidgets da CoW carregados. Se preferir execução automática, use o fallback 0x abaixo.`)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e)
      setLog((p) => p + `\n❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  async function tryZeroXAuto() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')
      setBusy(true)
      setLog((p) => p + `\nBuscando rotas na 0x...`)

      if (halfAmountWei === 0n) await prepareAmountsAndShowCow()

      let qCb: ZeroExQuote | null = null
      let qEth: ZeroExQuote | null = null

      try {
        qCb = await get0xQuoteBase({
          sellToken: USDC,
          buyToken: CBBTC,
          sellAmountWei: halfAmountWei.toString(),
          takerAddress: address,
        })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog((p) => p + `\n⚠️ 0x cbBTC falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
      }

      try {
        qEth = await get0xQuoteBase({
          sellToken: USDC,
          buyToken: 'ETH',
          sellAmountWei: halfAmountWei.toString(),
          takerAddress: address,
        })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog((p) => p + `\n⚠️ 0x ETH falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
      }

      const porSpender = new Map<string, bigint>()
      const add = (q?: ZeroExQuote | null) => {
        if (!q?.allowanceTarget) return
        porSpender.set(q.allowanceTarget, (porSpender.get(q.allowanceTarget) ?? 0n) + BigInt(q.sellAmount))
      }
      add(qCb)
      add(qEth)

      for (const [spender, total] of porSpender) {
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, spender as `0x${string}`],
        }) as bigint

        if (allowance < total) {
          setLog((p) => p + `\nAprovando USDC para ${spender}...`)
          const approveHash = await walletClient.writeContract({
            address: USDC,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender as `0x${string}`, total],
            chain: base,
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
          setLog((p) => p + `\n✔️ Approve confirmado.`)
        }
      }

      if (qCb) {
        setLog((p) => p + `\nEnviando swap USDC → cbBTC (0x)...`)
        const h = await walletClient.sendTransaction({ to: qCb.to, data: qCb.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: h })
        setLog((p) => p + `\n✔️ cbBTC confirmado (0x).`)
      }
      if (qEth) {
        setLog((p) => p + `\nEnviando swap USDC → ETH (0x)...`)
        const h = await walletClient.sendTransaction({ to: qEth.to, data: qEth.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: h })
        setLog((p) => p + `\n✔️ ETH confirmado (0x).`)
      }
      if (!qCb && !qEth) setLog((p) => p + `\nSem rotas na 0x para as duas pernas.`)
    } catch (e: any) {
      const msg = e?.response?.data?.reason || e?.shortMessage || e?.message || String(e)
      setLog((p) => p + `\n❌ Erro (0x): ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 16, textAlign: 'center', background: '#000', color: '#fff', borderRadius: 12 }}>
      
      {/* Logo no topo */}
      <div style={{ marginBottom: 20 }}>
        <Image
          src="/logo-vamos.png"  // coloque o arquivo em /public/logo-vamos.png
          alt="Vamos Pra Crypto"
          width={160}
          height={160}
          priority
        />
      </div>

      <h1 style={{ color: '#4ade80' }}>Executar 50/50 Swap</h1>
      <ConnectButton />

      {isConnected ? (
        <>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={handleExecuteCowFirst}
              disabled={busy}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none' }}
            >
              {busy ? 'Preparando…' : 'Executar 50/50 (CoW)'}
            </button>

            <button
              onClick={tryZeroXAuto}
              disabled={!enableZeroX || busy}
              title={!enableZeroX ? 'Carregue os widgets da CoW primeiro' : ''}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#111827', color: '#fff', border: 'none', opacity: enableZeroX ? 1 : 0.5 }}
            >
              Fallback 0x (automático)
            </button>
          </div>

          <p style={{ marginTop: 12 }}>
            Saldo em USDC: {usdcBalUi ? `${usdcBalUi.formatted} ${usdcBalUi.symbol}` : '-'}
          </p>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap', textAlign: 'left' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          {showCow && halfAmountWei > 0n && (
            <>
              <h3 style={{ marginTop: 18, color: '#38bdf8' }}>CoW — USDC → cbBTC (50%)</h3>
              <iframe
                src={cowUrlCbBtc}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
              <h3 style={{ marginTop: 18, color: '#38bdf8' }}>CoW — USDC → ETH (50%)</h3>
              <iframe
                src={cowUrlEth}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
            </>
          )}

          {balances.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ color: '#fbbf24' }}>Saldos na Base</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 8 }}>Token</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Símbolo</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Saldo</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Contrato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b, i) => (
                      <tr key={b.contract + i} style={{ borderTop: '1px solid #333' }}>
                        <td style={{ padding: 8 }}>{b.name}</td>
                        <td style={{ padding: 8 }}>{b.symbol}</td>
                        <td style={{ padding: 8 }}>{b.balance}</td>
                        <td style={{ padding: 8, fontFamily: 'monospace' }}>{b.contract}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
