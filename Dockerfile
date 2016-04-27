FROM node:5.11.0-wheezy

ADD . /home

RUN cd /home; npm install --production

EXPOSE 3000

CMD /bin/bash -c 'cd /home; node src/service.js -v -t $SECURE_TOKEN -m $MONGO_URL'