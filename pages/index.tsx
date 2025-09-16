// pages/index.tsx
import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance, useWalletClient } from 'wagmi'
import axios from 'axios'

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
const ETH = "0x4200000000000000000000000000000000000006"

export default function Home() {
  const { isConnected, address } = useAccount()
  const { data: balanceData } = useBalance({ address, token: USDC })
  const { data: walletClient } = useWalletClient()

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")

  async function executeSwap() {
    if (!walletClient || !balanceData) return
    setLoading(true)
    try {
      const half = (BigInt(balanceData.value.toString()) / 2n).toString()

      // 1. Swap USDC -> cbBTC
      const quote1 = await axios.get(
        `https://base.api.0x.org/swap/v1/quote`,
        { params: { sellToken: USDC, buyToken: CBBTC, sellAmount: half } }
      )

      const tx1 = {
        to: quote1.data.to,
        data: quote1.data.data,
        value: BigInt(quote1.data.value),
      }
      await walletClient.sendTransaction(tx1)
      setStatus("Swap 1 (USDC→cbBTC) enviado ✅")

      // 2. Swap USDC -> ETH
      const quote2 = await axios.get(
        `https://base.api.0x.org/swap/v1/quote`,
        { params: { sellToken: USDC, buyToken: ETH, sellAmount: half } }
      )

      const tx2 = {
        to: quote2.data.to,
        data: quote2.data.data,
        value: BigInt(quote2.data.value),
      }
      await walletClient.sendTransaction(tx2)
      setStatus("Swap 2 (USDC→ETH) enviado ✅")
    } catch (err: any) {
      console.error(err)
      setStatus("Erro no swap ❌")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Executar 50/50 Swap</h1>

      {/* Botão Connect Wallet */}
      <ConnectButton />

      {isConnected && (
        <>
          <p style={{ marginTop: 20 }}>
            Saldo em USDC:{" "}
            {balanceData ? balanceData.formatted : "0"} {balanceData?.symbol}
          </p>

          <button
            onClick={executeSwap}
            disabled={loading}
            style={{
              marginTop: 20,
              padding: "10px 20px",
              fontSize: 16,
              fontWeight: "bold",
              borderRadius: 8,
              background: "#4CAF50",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            {loading ? "Executando..." : "Executar 50/50"}
          </button>

          <p style={{ marginTop: 20 }}>{status}</p>
        </>
      )}
    </main>
  )
}
