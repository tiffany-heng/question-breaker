'use client';
import React, { useState, useEffect } from 'react';

export default function SafePage() {
  const [msg, setMsg] = useState('JS NOT RUNNING');

  useEffect(() => {
    setMsg('JS IS WORKING!');
  }, []);

  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: msg === 'JS IS WORKING!' ? 'green' : 'red' }}>
        {msg}
      </h1>
      
      <div style={{ marginTop: '20px' }}>
        <button 
          onClick={() => alert('BUTTON CLICKED!')}
          style={{ padding: '20px', background: 'blue', color: 'white', border: 'none', borderRadius: '10px', fontSize: '18px' }}
        >
          CLICK TO TEST
        </button>
      </div>

      <p style={{ marginTop: '30px', color: '#666' }}>
        If it stays RED, your phone is blocking the JavaScript bundle from your laptop.
      </p>
    </div>
  );
}
