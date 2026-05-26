import * as THREE from 'three';

/**
 * Procedurally generates a brush texture using HTML5 Canvas
 * and returns it as a THREE.CanvasTexture.
 * 
 * @param {string} type - Texture type ('solid', 'dry_brush', 'charcoal', 'ink_dotted', 'hatching', 'acrylic')
 * @returns {THREE.CanvasTexture}
 */
export function createBrushTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas to solid black (black represents empty pixels, which will be discarded)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    
    if (type === 'dry_brush') {
        // Draw many thin, scratchy horizontal lines with random gaps and opacities
        const lineCount = 100;
        for (let i = 0; i < lineCount; i++) {
            const y = Math.random() * canvas.height;
            const startX = Math.random() * canvas.width;
            const length = 40 + Math.random() * 240;
            const thickness = 0.5 + Math.random() * 1.8;
            const opacity = 0.15 + Math.random() * 0.7;
            
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.lineWidth = thickness;
            
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(startX + length, y);
            ctx.stroke();
            
            // Repeat wrap-around for tileability along U
            if (startX + length > canvas.width) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo((startX + length) - canvas.width, y);
                ctx.stroke();
            }
        }
        
    } else if (type === 'charcoal') {
        // High density grains to mimic rough paper or chalk/charcoal rub
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
        grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.6)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.6)');
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add random gritty pixel noise
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            // Apply noise to R, G, B channels
            const noise = (Math.random() - 0.5) * 160;
            const intensity = Math.max(0, Math.min(255, data[i] + noise));
            data[i] = intensity;
            data[i+1] = intensity;
            data[i+2] = intensity;
        }
        ctx.putImageData(imgData, 0, 0);
        
    } else if (type === 'ink_dotted') {
        // Splashy, splattered dots along the center lane of the stroke
        const dotCount = 50;
        for (let i = 0; i < dotCount; i++) {
            const x = Math.random() * canvas.width;
            const y = canvas.height * 0.25 + Math.random() * canvas.height * 0.5;
            const r = 2.0 + Math.random() * 7.5;
            const opacity = 0.4 + Math.random() * 0.6;
            
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            
            // Tiny satellite splatters
            const satelliteCount = Math.floor(Math.random() * 4);
            for (let j = 0; j < satelliteCount; j++) {
                const sx = x + (Math.random() - 0.5) * 22;
                const sy = y + (Math.random() - 0.5) * 22;
                const sr = 0.5 + Math.random() * 1.8;
                const sOpacity = Math.random() * opacity;
                
                ctx.fillStyle = `rgba(255, 255, 255, ${sOpacity})`;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
    } else if (type === 'hatching') {
        // Parallel clean diagonal sketch lines
        const stripeSpacing = 16;
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        
        // Draw stripes (including negative coordinates for complete diagonal coverage)
        for (let x = -canvas.height; x < canvas.width; x += stripeSpacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + canvas.height, canvas.height);
            ctx.stroke();
            
            // Tile wrapping for hatching along U
            if (x < 0) {
                ctx.beginPath();
                ctx.moveTo(x + canvas.width, 0);
                ctx.lineTo(x + canvas.width + canvas.height, canvas.height);
                ctx.stroke();
            }
        }
        
    } else if (type === 'acrylic') {
        // High-contrast paint brush tracks, thicker bristles
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0.1, 'rgba(255, 255, 255, 0.0)');
        grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.85)');
        grad.addColorStop(0.9, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw thick, wavy streaks
        const streakCount = 20;
        for (let i = 0; i < streakCount; i++) {
            ctx.beginPath();
            const y = canvas.height * 0.15 + Math.random() * canvas.height * 0.7;
            ctx.moveTo(0, y);
            
            // Draw a wavy path across U
            ctx.bezierCurveTo(
                canvas.width * 0.25, y + (Math.random() - 0.5) * 16,
                canvas.width * 0.75, y + (Math.random() - 0.5) * 16,
                canvas.width, y
            );
            
            ctx.lineWidth = 1.0 + Math.random() * 3.5;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + Math.random() * 0.6})`;
            ctx.stroke();
        }
        
    } else {
        // 'solid' / default: completely white band (standard solid gradient)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    return texture;
}
