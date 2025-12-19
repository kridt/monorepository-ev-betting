/**
 * Test SportMonks API
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const API_KEY = process.env.SPORTMONKS_API_KEY;
const BASE_URL = process.env.SPORTMONKS_BASE_URL || 'https://api.sportmonks.com/v3/football';

async function testAPI() {
  console.log('Testing SportMonks API...');
  console.log(`API Key: ${API_KEY?.substring(0, 10)}...`);
  console.log(`Base URL: ${BASE_URL}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ApiResponse = { data?: any; message?: string; rate_limit?: { remaining: number; resets_in_seconds: number } };

    // Test 1: Fetch leagues
    console.log('\n1. Fetching leagues...');
    const leaguesUrl = `${BASE_URL}/leagues?api_token=${API_KEY}&per_page=10`;
    const leaguesRes = await fetch(leaguesUrl);
    const leaguesData = await leaguesRes.json() as ApiResponse;

    console.log(`   Status: ${leaguesRes.status}`);
    console.log(`   Data type: ${typeof leaguesData.data}`);
    console.log(`   Data length: ${Array.isArray(leaguesData.data) ? leaguesData.data.length : 'N/A'}`);

    if (leaguesData.data && leaguesData.data.length > 0) {
      console.log('   First league:', JSON.stringify(leaguesData.data[0], null, 2).substring(0, 500));
    }

    if (leaguesData.message) {
      console.log('   Message:', leaguesData.message);
    }

    // Test 2: Fetch specific league (Premier League ID is typically 8)
    console.log('\n2. Fetching Premier League (ID: 8)...');
    const plUrl = `${BASE_URL}/leagues/8?api_token=${API_KEY}&include=currentSeason`;
    const plRes = await fetch(plUrl);
    const plData = await plRes.json() as ApiResponse;

    console.log(`   Status: ${plRes.status}`);
    if (plData.data) {
      console.log('   League data:', JSON.stringify(plData.data, null, 2).substring(0, 500));
    }
    if (plData.message) {
      console.log('   Message:', plData.message);
    }

    // Test 3: Check subscription info
    console.log('\n3. Checking my subscription...');
    const subUrl = `https://api.sportmonks.com/v3/my/enrichments?api_token=${API_KEY}`;
    const subRes = await fetch(subUrl);
    const subData = await subRes.json() as ApiResponse;

    console.log(`   Status: ${subRes.status}`);
    if (Array.isArray(subData.data)) {
      console.log(`   Enrichments: ${subData.data.length}`);
      subData.data.slice(0, 5).forEach((e: { name: string }) => {
        console.log(`     - ${e.name}`);
      });
    }

    // Test 4: Rate limit info
    if (leaguesData.rate_limit) {
      console.log('\n4. Rate limit info:');
      console.log(`   Remaining: ${leaguesData.rate_limit.remaining}`);
      console.log(`   Resets in: ${leaguesData.rate_limit.resets_in_seconds}s`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testAPI();
