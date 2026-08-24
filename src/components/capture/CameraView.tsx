'use client'

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

export interface CameraViewHandle {
  /** Captura o frame atual do vídeo como JPEG (sem espelhamento). */
  capture(): Promise<Blob>
}

interface CameraViewProps {
  ref: Ref<CameraViewHandle>
  /** Erro de câmera em linguagem de usuário (permissão, ausência etc.). */
  onError: (message: string) => void
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Permissão de câmera negada. Autorize o acesso nas configurações do navegador ou use "Escolher arquivo".'
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Nenhuma câmera encontrada neste dispositivo. Use "Escolher arquivo".'
      case 'NotReadableError':
        return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.'
    }
  }
  return 'Não foi possível abrir a câmera. Use "Escolher arquivo".'
}

export default function CameraView({ ref, onError }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (error) {
        if (!cancelled) onError(describeCameraError(error))
      }
    }

    void start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [onError])

  useImperativeHandle(ref, () => ({
    capture: () => {
      const video = videoRef.current
      if (!video || video.videoWidth === 0) {
        return Promise.reject(new Error('A câmera ainda não está pronta.'))
      }
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        return Promise.reject(new Error('Canvas 2D indisponível.'))
      }
      context.drawImage(video, 0, 0)
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Falha ao capturar o frame.')),
          'image/jpeg',
          0.95,
        )
      })
    },
  }))

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      // Pré-visualização espelhada (convenção de selfie); a captura não é.
      className="h-full w-full -scale-x-100 object-contain"
    />
  )
}
