import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import FindMatch from './pages/FindMatch';
import MatchHistory from './pages/MatchHistory';
import Profile from './pages/Profile';
export default function App(){ return (<Router><Routes><Route path='/' element={<Home />} /><Route path='/find-match' element={<FindMatch />} /><Route path='/match-history' element={<MatchHistory />} /><Route path='/profile' element={<Profile />} /></Routes></Router>);}