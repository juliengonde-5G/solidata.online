import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

/**
 * Hook d'écoute de l'event `cav:sensor-reading` émis par le backend
 * chaque fois qu'un uplink LoRaWAN est traité.
 *
 * @param {(reading: {cav_id:number, fill_level:number, fill_source:string, battery:number, rssi:number, temperature:number, tilt:boolean, alarms:string[], timestamp:string}) => void} onReading
 */
export default function useCavSensorSocket(onReading) {
  const cbRef = useRef(onReading);
  cbRef.current = onReading;

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return undefined;

    const socket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('cav:sensor-reading', (data) => {
      if (cbRef.current) cbRef.current(data);
    });

    return () => {
      socket.off('cav:sensor-reading');
      socket.disconnect();
    };
  }, []);
}
