import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.esm.min.mjs'

window.broadcastBoxURL = 'https://b.siobud.com'
const browserTab = document.getElementById('try-browser-tab')
const obsTab = document.getElementById('try-obs-tab')
const browserPanel = document.getElementById('try-browser-panel')
const obsPanel = document.getElementById('try-obs-panel')
const nerdModeToggle = document.getElementById('nerd-mode-toggle')
const obsStreamKeyOutput = document.getElementById('try-obs-stream-key')
const copyTokenButton = document.getElementById('try-copy-token')
const publishScreenButton = document.getElementById('try-publish-screen')
const publishWebcamButton = document.getElementById('try-publish-webcam')
const stopPublishButton = document.getElementById('try-stop-publish')
const publishPreview = document.getElementById('try-publish-preview')
const publishStatus = document.getElementById('try-publish-status')
const hostedPlayerLink = document.getElementById('try-hosted-player')
const watchButton = document.getElementById('try-watch')
const video = document.getElementById('try-video')
const status = document.getElementById('try-status')
let peerConnection
let publishPeerConnection
let publishMediaStream
let publishSessionURL

const generateStreamKey = () => {
  const bytes = new Uint8Array(11)
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    window.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  return `wfts-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const setStatus = (message) => {
  status.textContent = message
}

const setPublishStatus = (message) => {
  publishStatus.textContent = message
}

const setNerdMode = (isEnabled) => {
  document.body.classList.toggle('nerd-mode', isEnabled)
}

const isNerdModeContent = (element) => {
  for (let current = element; current && current !== document.body; current = current.parentElement) {
    if (current.classList.contains('nerd-mode')) {
      return true
    }
  }

  return false
}

const renderMermaidDiagrams = async (diagrams) => {
  const pendingDiagrams = diagrams.filter((diagram) => diagram.dataset.processed !== 'true')
  if (pendingDiagrams.length > 0) {
    await mermaid.run({ nodes: pendingDiagrams })
  }
}

const renderNerdModeDiagrams = async () => {
  await new Promise((resolve) => window.requestAnimationFrame(resolve))
  if (!document.body.classList.contains('nerd-mode')) {
    return
  }

  const diagrams = Array.from(document.querySelectorAll('.mermaid')).filter(isNerdModeContent)
  await renderMermaidDiagrams(diagrams)
}

const getVisibleElement = () => {
  const elements = Array.from(document.querySelectorAll('h3, h4, p, article'))
  return elements.find((el) => {
    const rect = el.getBoundingClientRect()
    return rect.top > 0 && rect.top < window.innerHeight / 2
  })
}

const updateNerdMode = async () => {
  const isEnabled = nerdModeToggle.checked
  const anchor = getVisibleElement()
  const offset = anchor ? anchor.getBoundingClientRect().top : 0

  setNerdMode(isEnabled)

  if (anchor) {
    const newRect = anchor.getBoundingClientRect()
    window.scrollBy(0, newRect.top - offset)
  }

  if (isEnabled) {
    await renderNerdModeDiagrams()
    if (anchor) {
      const newRect = anchor.getBoundingClientRect()
      window.scrollBy(0, newRect.top - offset)
    }
  }
}

const streamKey = generateStreamKey()
const encodedStreamKey = encodeURIComponent(streamKey)
obsStreamKeyOutput.textContent = streamKey
hostedPlayerLink.href = `${broadcastBoxURL}/${encodedStreamKey}?cinemaMode=true`

const copyStreamKey = async () => {
  try {
    await navigator.clipboard.writeText(streamKey)
    copyTokenButton.textContent = 'Copied'
    window.setTimeout(() => {
      copyTokenButton.textContent = 'Copy'
    }, 1400)
  } catch {
    const range = document.createRange()
    range.selectNodeContents(obsStreamKeyOutput)
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
      copyTokenButton.textContent = 'Selected'
    }
  }
}

const selectPublishTab = (selectedTab) => {
  const browserSelected = selectedTab === 'browser'
  browserTab.setAttribute('aria-selected', browserSelected ? 'true' : 'false')
  obsTab.setAttribute('aria-selected', browserSelected ? 'false' : 'true')
  browserPanel.hidden = !browserSelected
  obsPanel.hidden = browserSelected
}

const setPublishControls = (isPublishing) => {
  publishScreenButton.disabled = isPublishing
  publishWebcamButton.disabled = isPublishing
  stopPublishButton.disabled = !isPublishing
}

const stopBrowserPublish = async (message = 'Not publishing.') => {
  const sessionURL = publishSessionURL
  publishSessionURL = undefined

  if (sessionURL) {
    fetch(sessionURL, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${streamKey}`
      }
    }).catch(() => {})
  }

  if (publishPeerConnection) {
    publishPeerConnection.close()
    publishPeerConnection = undefined
  }

  if (publishMediaStream) {
    publishMediaStream.getTracks().forEach((track) => track.stop())
    publishMediaStream = undefined
  }

  publishPreview.srcObject = null
  setPublishControls(false)
  setPublishStatus(message)
}

const publishFromBrowser = async (source) => {
  await stopBrowserPublish('Starting browser publisher...')
  publishScreenButton.disabled = true
  publishWebcamButton.disabled = true
  stopPublishButton.disabled = true

  try {
    if (!navigator.mediaDevices) {
      throw new Error('Browser media capture is not available')
    }

    setPublishStatus('Waiting for browser permission...')
    const mediaStream = source === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

    publishMediaStream = mediaStream
    publishPreview.srcObject = mediaStream

    const currentConnection = new RTCPeerConnection()
    publishPeerConnection = currentConnection

    mediaStream.getTracks().forEach((track) => {
      currentConnection.addTrack(track, mediaStream)
      track.addEventListener('ended', () => {
        if (publishPeerConnection === currentConnection) {
          stopBrowserPublish()
        }
      })
    })

    currentConnection.oniceconnectionstatechange = () => {
      setPublishStatus(`Publish connection state: ${currentConnection.iceConnectionState}`)
    }

    const offer = await currentConnection.createOffer()
    await currentConnection.setLocalDescription(offer)

    const response = await fetch(`${window.broadcastBoxURL}/api/whip`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${streamKey}`,
        'Content-Type': 'application/sdp'
      }
    })

    if (!response.ok) {
      throw new Error(`WHIP publish failed with HTTP ${response.status}`)
    }

    const sessionLocation = response.headers.get('Location')
    if (sessionLocation) {
      publishSessionURL = new URL(sessionLocation, window.broadcastBoxURL).toString()
    }

    const answer = await response.text()
    await currentConnection.setRemoteDescription({
      sdp: answer,
      type: 'answer'
    })

    setPublishControls(true)
    setPublishStatus('Publishing from this browser.')
  } catch (error) {
    await stopBrowserPublish()
    const message = error instanceof Error ? error.message : 'Unable to publish'
    setPublishStatus(`${message}.`)
  }
}

const closeExistingConnection = () => {
  if (peerConnection) {
    peerConnection.close()
    peerConnection = undefined
  }

  video.srcObject = null
}

const watchStream = async () => {
  closeExistingConnection()
  watchButton.disabled = true
  setStatus('Connecting to b.siobud.com...')

  try {
    const currentConnection = new RTCPeerConnection()
    peerConnection = currentConnection
    currentConnection.addTransceiver('audio', { direction: 'recvonly' })
    currentConnection.addTransceiver('video', { direction: 'recvonly' })

    currentConnection.ontrack = (event) => {
      video.srcObject = event.streams[0]
      setStatus('Playing the live stream.')
    }

    currentConnection.oniceconnectionstatechange = () => {
      setStatus(`Connection state: ${currentConnection.iceConnectionState}`)
    }

    const offer = await currentConnection.createOffer()
    await currentConnection.setLocalDescription(offer)

    const response = await fetch(`${currentBroadcastBoxURL}/api/whep`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${streamKey}`,
        'Content-Type': 'application/sdp'
      }
    })

    if (!response.ok) {
      throw new Error(`WHEP request failed with HTTP ${response.status}`)
    }

    const answer = await response.text()
    await currentConnection.setRemoteDescription({
      sdp: answer,
      type: 'answer'
    })
  } catch (error) {
    closeExistingConnection()
    const message = error instanceof Error ? error.message : 'Unable to connect'
    setStatus(`${message}. Start a broadcast, then try again.`)
  } finally {
    watchButton.disabled = false
  }
}

watchButton.addEventListener('click', watchStream)
copyTokenButton.addEventListener('click', copyStreamKey)
browserTab.addEventListener('click', () => selectPublishTab('browser'))
obsTab.addEventListener('click', () => selectPublishTab('obs'))
publishScreenButton.addEventListener('click', () => publishFromBrowser('screen'))
publishWebcamButton.addEventListener('click', () => publishFromBrowser('webcam'))
stopPublishButton.addEventListener('click', () => stopBrowserPublish())

mermaid.initialize({ startOnLoad: false, theme: 'dark' })

const diagrams = Array.from(document.querySelectorAll('.mermaid'))
await renderMermaidDiagrams(diagrams.filter((diagram) => !isNerdModeContent(diagram)))

nerdModeToggle.addEventListener('change', updateNerdMode)
await updateNerdMode()
