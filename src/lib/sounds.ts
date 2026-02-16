// Sound utility for notification sounds
// Uses Web Audio API to generate simple notification sounds

class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;
  private initialized: boolean = false;

  // Initialize audio context on user interaction
  private async ensureContext(): Promise<AudioContext | null> {
    if (!this.enabled) return null;
    
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      // Resume if suspended (browsers require user interaction)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('[Sound] AudioContext resumed');
      }
      
      this.initialized = true;
      return this.audioContext;
    } catch (e) {
      console.warn('[Sound] AudioContext init failed:', e);
      return null;
    }
  }

  // Call this on first user interaction
  async init() {
    await this.ensureContext();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  // Play a simple beep sound
  private async playBeep(frequency: number, duration: number, type: OscillatorType = 'sine') {
    if (!this.enabled) return;
    
    try {
      const ctx = await this.ensureContext();
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      // Volume envelope
      const now = ctx.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.4, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (e) {
      console.warn('[Sound] Playback failed:', e);
    }
  }

  // Message received sound
  async playMessage() {
    await this.playBeep(800, 0.1, 'sine');
    setTimeout(() => this.playBeep(1000, 0.1, 'sine'), 100);
  }

  // Message sent sound
  async playSent() {
    await this.playBeep(600, 0.05, 'sine');
  }

  // Incoming call ring - returns interval ID for stopping
  playCallRing(): NodeJS.Timeout {
    if (!this.enabled) return setTimeout(() => {}, 1000);
    
    const playRing = async () => {
      await this.playBeep(500, 0.3, 'sine');
      setTimeout(() => this.playBeep(700, 0.3, 'sine'), 300);
    };
    
    // Play immediately
    playRing();
    
    // Continue ringing
    return setInterval(playRing, 1500);
  }

  // Call connected sound
  async playCallConnected() {
    await this.playBeep(800, 0.1, 'sine');
    setTimeout(() => this.playBeep(1000, 0.1, 'sine'), 100);
    setTimeout(() => this.playBeep(1200, 0.15, 'sine'), 200);
  }

  // Call ended sound
  async playCallEnded() {
    await this.playBeep(400, 0.2, 'sine');
    setTimeout(() => this.playBeep(300, 0.3, 'sine'), 200);
  }

  // Notification sound
  async playNotification() {
    await this.playBeep(900, 0.1, 'sine');
    setTimeout(() => this.playBeep(1100, 0.15, 'sine'), 100);
  }

  // Error sound
  async playError() {
    await this.playBeep(200, 0.3, 'square');
  }

  // Success sound
  async playSuccess() {
    await this.playBeep(600, 0.1, 'sine');
    setTimeout(() => this.playBeep(800, 0.15, 'sine'), 100);
  }
}

export const soundManager = new SoundManager();

// Initialize on first user interaction
if (typeof window !== 'undefined') {
  const initOnInteraction = () => {
    soundManager.init();
    window.removeEventListener('click', initOnInteraction);
    window.removeEventListener('keydown', initOnInteraction);
    window.removeEventListener('touchstart', initOnInteraction);
  };
  
  window.addEventListener('click', initOnInteraction);
  window.addEventListener('keydown', initOnInteraction);
  window.addEventListener('touchstart', initOnInteraction);
}
