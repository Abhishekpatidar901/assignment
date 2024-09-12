import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [file, setFile] = useState(null);
  const [requestId, setRequestId] = useState('');
  const [status, setStatus] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await axios.post('http://localhost:3001/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    setRequestId(response.data.requestId);
    console.log(requestId)
  };

  const checkStatus = async () => {
    const response = await axios.get(`http://localhost:3001/status/${requestId}`);
    setStatus(response.data.status);
  };

  return (
    <div>
      <h1>CSV Image Processor</h1>
      <div>
        <input type="file" onChange={handleFileChange} />
        <button onClick={handleUpload}>Upload CSV</button>
      </div>
      {requestId && (
        <div>
          <h3>Request ID: {requestId}</h3>
          <button onClick={checkStatus}>Check Status</button>
          {status && <p>Status: {status}</p>}
        </div>
       )} 
    </div>
  );
}

export default App;
