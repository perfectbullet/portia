FROM scrapinghub/portia:latest
WORKDIR /app/slyd

ENV PATH="/opt/qt59/5.9.1/gcc_64/bin:${PATH}"
ENV DEBIAN_FRONTEND noninteractive
ENV QT_MIRROR http://ftp.fau.de/qtproject/official_releases/qt/5.9/5.9.1/qt-opensource-linux-x64-5.9.1.run

#RUN apt update && apt install vim
COPY docker/nginx /etc/nginx
COPY . /app
RUN pip install -e /app/slyd && pip install -e /app/slybot
RUN pip install -e /app/portia2code-master
RUN python3 /app/portia_server/manage.py migrate

EXPOSE 9002
ENTRYPOINT ["/app/docker/entry"]
