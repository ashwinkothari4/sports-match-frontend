import React, { useState } from 'react';
import { matchmakingAPI } from '../services/api';
export default function FindMatch(){
  const [result, setResult] = useState(null);
  async function find(){ 
    const payload = { userId: 'replace-with-user', sport: 'basketball', location: { latitude:40.7128, longitude:-74.0060 }, schedule: new Date().toISOString(), playstyle: 'casual' };
    const res = await matchmakingAPI.suggestOpponent(payload);
    setResult(res);
  }
  return (<div className='container'><h2>Find Match</h2><button onClick={find}>Find</button><pre>{JSON.stringify(result,null,2)}</pre></div>);
}
