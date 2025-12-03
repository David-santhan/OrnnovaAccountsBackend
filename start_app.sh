#!/bin/bash

# 1) Start backend
cd "/Users/apple/Desktop/LiquidityApp/backend"
dotnet run --project . &

# Wait 8 seconds
sleep 8

# 2) Start frontend
cd "/Users/apple/Desktop/LiquidityApp/frontend"
npm start &
